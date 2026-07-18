const axios = require("axios");
const Booking = require("../../../models/Booking");
const logger = require("../../../config/logger");
const { env, isPesapalConfigured } = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const bookingsService = require("../../bookings");
const paymentsService = require("..");
const notificationsService = require("../../notifications");
const {
  normalizePesapalStatus,
  isPendingPesapalStatus,
  resolvePesapalResponseStatusCode,
  isVerifiedPesapalPayment,
  resolvePesapalPaymentState,
  toMoneyAmount,
  normalizeCurrency,
  buildPesapalOrderReference,
  resolveOrderTrackingId,
  resolveMerchantReference,
  resolveRedirectUrl,
  isLocalOrPrivateRedirectUrl
} = require("../../../integrations/pesapal/pesapal.utils");

const pesapalClient = axios.create({
  baseURL: env.PESAPAL_BASE_URL,
  timeout: env.PESAPAL_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json"
  }
});

const shouldMock = Boolean(env.PESAPAL_MOCK_MODE);

const authTokenCache = {
  token: "",
  expiresAt: 0
};

const ipnIdCache = {
  id: env.PESAPAL_IPN_ID || ""
};

const resolvePath = (path = "") => {
  const token = String(path || "").trim();
  if (!token) {
    return "/";
  }

  return token.startsWith("/") ? token : `/${token}`;
};

const areLiveRedirectsLocal = () =>
  isLocalOrPrivateRedirectUrl(env.PESAPAL_SUCCESS_URL) ||
  isLocalOrPrivateRedirectUrl(env.PESAPAL_CANCEL_URL);

const resolvePesapalIpnUrl = () =>
  String(env.PESAPAL_IPN_URL || env.PESAPAL_CALLBACK_URL || "").trim();

const ensurePesapalConfiguration = () => {
  if (shouldMock) {
    return;
  }

  if (!isPesapalConfigured) {
    throw new AppError(
      "Pesapal is not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET, or enable PESAPAL_MOCK_MODE=true.",
      503,
      "PESAPAL_NOT_CONFIGURED"
    );
  }

  if (!env.PESAPAL_IPN_ID && !resolvePesapalIpnUrl()) {
    throw new AppError(
      "Pesapal IPN setup is required in live mode. Set PESAPAL_IPN_ID, or set PESAPAL_IPN_URL so the app can register it.",
      503,
      "PESAPAL_IPN_SETUP_MISSING"
    );
  }

  if (!env.PESAPAL_ALLOW_LOCAL_REDIRECTS && areLiveRedirectsLocal()) {
    throw new AppError(
      "Pesapal live mode requires public callback URLs. Localhost/127.0.0.1 redirects are blocked. Set public PESAPAL_SUCCESS_URL and PESAPAL_CANCEL_URL.",
      422,
      "PESAPAL_INVALID_REDIRECT_URLS",
      {
        PESAPAL_SUCCESS_URL: env.PESAPAL_SUCCESS_URL,
        PESAPAL_CANCEL_URL: env.PESAPAL_CANCEL_URL
      }
    );
  }
};

const requestPesapal = async ({
  method = "get",
  path = "/",
  payload = undefined,
  params = undefined,
  headers = {},
  requestId = ""
} = {}) => {
  try {
    const { data } = await pesapalClient.request({
      method,
      url: resolvePath(path),
      data: payload,
      params,
      headers: {
        ...(requestId ? { "x-request-id": requestId } : {}),
        ...headers
      }
    });

    return data;
  } catch (error) {
    const statusCode = Number(error.response?.status || 502);
    const responseData = error.response?.data || {};
    const responsePreview =
      typeof responseData === "string"
        ? responseData.slice(0, 500)
        : JSON.stringify(responseData).slice(0, 500);

    const details = {
      statusCode,
      pesapalPath: resolvePath(path),
      responsePreview,
      requestId
    };

    if (statusCode === 403) {
      throw new AppError(
        "Pesapal blocked the request (HTTP 403). Confirm account activation and any gateway-side IP/security restrictions.",
        502,
        "PESAPAL_EDGE_BLOCKED",
        details
      );
    }

    throw new AppError(
      `Pesapal API request failed: ${error.message || "unknown error"}`,
      502,
      "PESAPAL_API_REQUEST_FAILED",
      details
    );
  }
};

const extractBokunFinalizationErrorMeta = (error = null) => {
  const statusCode = Number(error?.statusCode || error?.details?.statusCode || 0);
  return {
    code: String(error?.code || "UNKNOWN_ERROR"),
    statusCode: Number.isFinite(statusCode) ? statusCode : 0,
    message: String(error?.message || "Bokun finalization error"),
    attempts: Array.isArray(error?.details?.attempts) ? error.details.attempts : []
  };
};

const isBokunFinalizationPendingError = (error = null) => {
  const details = extractBokunFinalizationErrorMeta(error);
  if (
    [
      "BOKUN_FINALIZATION_PENDING",
      "BOOKING_FINALIZATION_IN_PROGRESS",
      "PAYMENT_PROCESSING"
    ].includes(details.code)
  ) {
    return true;
  }

  if (details.code !== "BOKUN_REQUEST_FAILED") {
    return false;
  }

  return details.statusCode >= 500;
};

const isPesapalVerificationSecurityError = (error = null) =>
  [
    "PESAPAL_TRACKING_MISMATCH",
    "PESAPAL_MERCHANT_REFERENCE_MISMATCH",
    "PESAPAL_VERIFIED_AMOUNT_MISMATCH",
    "PESAPAL_VERIFIED_CURRENCY_MISMATCH"
  ].includes(String(error?.code || ""));

const parseExpiryTimestamp = (payload = {}) => {
  const explicitDate = String(payload?.expiryDate || payload?.expiry_date || payload?.expires_at || "").trim();
  if (explicitDate) {
    const parsed = Date.parse(explicitDate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const expiresIn = Number(payload?.expires_in || payload?.expiresIn || 0);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return Date.now() + Math.max(30, expiresIn - 30) * 1000;
  }

  return Date.now() + 50 * 60 * 1000;
};

const getPesapalAccessToken = async (requestId) => {
  if (shouldMock) {
    return "MOCK_PESAPAL_ACCESS_TOKEN";
  }

  if (authTokenCache.token && Date.now() + 60 * 1000 < authTokenCache.expiresAt) {
    return authTokenCache.token;
  }

  const response = await requestPesapal({
    method: "post",
    path: env.PESAPAL_AUTH_PATH,
    payload: {
      consumer_key: env.PESAPAL_CONSUMER_KEY,
      consumer_secret: env.PESAPAL_CONSUMER_SECRET
    },
    requestId
  });

  const token = String(response?.token || response?.access_token || "").trim();
  if (!token) {
    throw new AppError(
      "Pesapal token response is missing access token",
      502,
      "PESAPAL_TOKEN_MISSING",
      {
        response
      }
    );
  }

  authTokenCache.token = token;
  authTokenCache.expiresAt = parseExpiryTimestamp(response);

  return token;
};

const getPesapalNotificationId = async ({ accessToken, requestId }) => {
  if (env.PESAPAL_IPN_ID) {
    return env.PESAPAL_IPN_ID;
  }

  if (ipnIdCache.id) {
    return ipnIdCache.id;
  }

  const ipnUrl = resolvePesapalIpnUrl();
  if (!ipnUrl) {
    throw new AppError(
      "Pesapal IPN URL is missing. Set PESAPAL_IPN_URL to a public backend callback URL.",
      503,
      "PESAPAL_IPN_URL_MISSING"
    );
  }

  const response = await requestPesapal({
    method: "post",
    path: env.PESAPAL_REGISTER_IPN_PATH,
    payload: {
      url: ipnUrl,
      ipn_notification_type: "GET"
    },
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    requestId
  });

  const notificationId = String(
    response?.ipn_id ||
      response?.ipnId ||
      response?.notification_id ||
      response?.notificationId ||
      response?.id ||
      ""
  ).trim();

  if (!notificationId) {
    throw new AppError(
      "Pesapal IPN registration did not return a notification ID",
      502,
      "PESAPAL_IPN_REGISTER_FAILED",
      { response }
    );
  }

  ipnIdCache.id = notificationId;

  logger.info("Pesapal IPN registered", {
    requestId,
    ipnUrl,
    notificationId
  });

  return notificationId;
};

const validateAmountAndCurrency = ({ booking, amount, currency }) => {
  if (!booking) {
    throw new AppError("Booking is required", 400, "BOOKING_REQUIRED");
  }

  const expectedAmount = Number(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
  const expectedCurrency = String(booking.currency || booking.pricingSnapshot?.currency || "USD");

  if (amount !== undefined && amount !== null) {
    const requestedAmount = Number(amount);
    if (Math.abs(requestedAmount - expectedAmount) > 0.009) {
      throw new AppError("Amount mismatch with booking quote", 409, "PAYMENT_AMOUNT_MISMATCH");
    }
  }

  if (currency && String(currency) !== expectedCurrency) {
    throw new AppError("Currency mismatch with booking quote", 409, "PAYMENT_CURRENCY_MISMATCH");
  }
};

const toPaymentCallbackBooking = (booking = {}) => ({
  bookingId: booking._id,
  bookingReference: booking.bookingReference,
  bokunBookingId: booking.bokunBookingId || "",
  bokunConfirmationCode: booking.bokunConfirmationCode || "",
  paymentStatus: booking.paymentStatus || "pending",
  bookingStatus: booking.bookingStatus || "pending",
  supplierStatus: booking.supplierStatus || "awaiting_payment",
  sourceChannel: booking.sourceChannel || "direct_website",
  isAgentBooking: Boolean(booking.agentId)
});

const isInvoiceReconciledPaid = (booking = {}) =>
  String(booking?.invoiceSnapshot?.paymentStatus || "").toLowerCase() === "paid" &&
  Number(booking?.invoiceSnapshot?.amountPaid || 0) > 0;

const resolveBokunSyncStatus = (booking = {}) => {
  if (booking?.bokunBookingId) return "synced";

  if (booking?.supplierStatus === "supplier_failed") return "manual_review_required";
  if (booking?.supplierStatus === "supplier_pending") return "processing";

  const finalization = booking?.pendingCheckout?.finalization || {};
  const status = String(finalization.status || "").toLowerCase();

  if (status === "processing") return "processing";
  if (status === "pending_retry") return "retry_scheduled";
  if (status === "failed") return "manual_review_required";
  return booking?.paymentStatus === "paid" ? "queued" : "not_started";
};

const resolveCustomerBookingStatus = (booking = {}, bokunSyncStatus = "") => {
  const paymentStatus = String(booking?.paymentStatus || "").toLowerCase();
  const bookingStatus = String(booking?.bookingStatus || "").toLowerCase();
  if (bookingStatus === "cancelled" || paymentStatus === "refunded") return "cancelled";
  if (paymentStatus === "reversed") return "reversed";
  if (paymentStatus === "failed" || bookingStatus === "failed") return "failed";
  if (booking?.bokunBookingId && bookingStatus === "confirmed") return "confirmed";
  if (["initiated", "processing", "verification_error", "pending"].includes(paymentStatus)) {
    return "payment_pending";
  }
  if (paymentStatus === "paid" && bokunSyncStatus === "manual_review_required") {
    return "manual_review_required";
  }
  if (paymentStatus === "paid") return "paid_supplier_pending";
  return "payment_pending";
};

const buildCustomerPaymentStatus = async ({ booking, status = "", message = "" } = {}) => {
  const paidAmount = await paymentsService.getVerifiedPaidAmountByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "pesapal"
  });
  const bokunSyncStatus = resolveBokunSyncStatus(booking);
  const bookingStatus = resolveCustomerBookingStatus(booking, bokunSyncStatus);
  const invoiceStatus = String(booking?.invoiceSnapshot?.paymentStatus || "unpaid").toLowerCase();
  const isTerminal = ["confirmed", "manual_review_required", "cancelled", "failed", "reversed"].includes(bookingStatus);
  const customerMessage =
    message ||
    (bookingStatus === "confirmed"
      ? "Your booking is confirmed."
      : bookingStatus === "manual_review_required"
        ? "Your payment is confirmed. Our team is reviewing the supplier confirmation."
        : bookingStatus === "paid_supplier_pending"
          ? "Payment received. Supplier confirmation is pending."
        : bookingStatus === "payment_pending"
          ? "We are confirming your payment with Pesapal."
          : bookingStatus === "reversed"
            ? "This payment was reversed by the payment provider."
            : "The payment could not be confirmed.");

  return {
    status,
    message: customerMessage,
    paymentStatus: String(booking?.paymentStatus || "pending").toLowerCase(),
    invoiceStatus,
    bookingStatus,
    bokunSyncStatus,
    amountPaid: Number(paidAmount || booking?.invoiceSnapshot?.amountPaid || 0),
    currency: booking?.currency || booking?.pricingSnapshot?.currency || "USD",
    bookingReference: booking?.bookingReference || "",
    confirmationCode: booking?.bokunConfirmationCode || "",
    paymentMethod: booking?.paymentMethod || "pesapal",
    paidAt: booking?.pendingCheckout?.paymentVerifiedAt || "",
    isTerminal,
    booking: {
      ...toPaymentCallbackBooking(booking),
      bookingStatus,
      productTitle: booking?.productTitle || "",
      travelDate: booking?.travelDate || "",
      startTime: booking?.startTime || "",
      travelers: booking?.paxSummary || {},
      amountPaid: Number(paidAmount || booking?.invoiceSnapshot?.amountPaid || 0),
      currency: booking?.currency || booking?.pricingSnapshot?.currency || "USD",
      confirmationCode: booking?.bokunConfirmationCode || "",
      invoiceStatus,
      bokunSyncStatus,
      supplierStatus: booking?.supplierStatus || "awaiting_payment",
      paymentMethod: booking?.paymentMethod || "pesapal",
      paidAt: booking?.pendingCheckout?.paymentVerifiedAt || ""
    }
  };
};

const isFinalizationRetryDue = (booking = {}) => {
  const finalization = booking?.pendingCheckout?.finalization || {};
  if (String(finalization.status || "").toLowerCase() !== "pending_retry") {
    return true;
  }

  const nextRetryAt = Date.parse(String(finalization.nextRetryAt || ""));
  return !Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now();
};

const validatePesapalVerification = ({ booking, verification, orderTrackingId = "", orderMerchantReference = "" }) => {
  const expectedTrackingId = String(booking?.paymentTransactionId || booking?.dpoTransactionToken || "").trim();
  const returnedTrackingId = String(verification?.providerOrderTrackingId || verification?.orderTrackingId || "").trim();
  const expectedMerchantReference = String(
    booking?.pendingCheckout?.pesapalMerchantReference || buildPesapalOrderReference(booking?.bookingReference)
  ).trim();
  const returnedMerchantReference = String(verification?.merchantReference || orderMerchantReference || "").trim();
  const expectedAmount = toMoneyAmount(booking?.amount || booking?.pricingSnapshot?.finalPayable || 0);
  const returnedAmount = toMoneyAmount(verification?.amount || 0);
  const expectedCurrency = normalizeCurrency(booking?.currency || booking?.pricingSnapshot?.currency || "USD");
  const returnedCurrency = normalizeCurrency(verification?.currency || expectedCurrency);

  if (expectedTrackingId && orderTrackingId && expectedTrackingId !== String(orderTrackingId).trim()) {
    throw new AppError("Pesapal tracking ID does not match this booking", 409, "PESAPAL_TRACKING_MISMATCH");
  }
  if (returnedTrackingId && expectedTrackingId && returnedTrackingId !== expectedTrackingId) {
    throw new AppError("Pesapal verification returned a different tracking ID", 409, "PESAPAL_TRACKING_MISMATCH");
  }
  if (returnedMerchantReference && expectedMerchantReference && returnedMerchantReference !== expectedMerchantReference) {
    throw new AppError("Pesapal merchant reference does not match this booking", 409, "PESAPAL_MERCHANT_REFERENCE_MISMATCH");
  }
  if (verification?.isPaid && returnedAmount > 0 && Math.abs(returnedAmount - expectedAmount) > 0.009) {
    throw new AppError("Pesapal verified amount does not match this booking", 409, "PESAPAL_VERIFIED_AMOUNT_MISMATCH", {
      bookingReference: booking?.bookingReference || "",
      expectedAmount,
      verifiedAmount: returnedAmount,
      expectedCurrency,
      verifiedCurrency: returnedCurrency,
      orderTrackingId: expectedTrackingId || returnedTrackingId || ""
    });
  }
  if (verification?.isPaid && returnedCurrency !== expectedCurrency) {
    throw new AppError("Pesapal verified currency does not match this booking", 409, "PESAPAL_VERIFIED_CURRENCY_MISMATCH", {
      bookingReference: booking?.bookingReference || "",
      expectedAmount,
      verifiedAmount: returnedAmount,
      expectedCurrency,
      verifiedCurrency: returnedCurrency,
      orderTrackingId: expectedTrackingId || returnedTrackingId || ""
    });
  }
};

const resolveOrCreatePendingBooking = async ({ payload, auth, requestId }) => {
  if (payload.bookingId) {
    const booking = await Booking.findById(payload.bookingId);
    if (!booking) {
      throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    if (booking.paymentStatus === "paid" && booking.bokunBookingId) {
      return booking;
    }

    if (!booking.pendingCheckout?.checkoutPayload) {
      throw new AppError("Pending checkout payload missing for this booking", 409, "PENDING_CHECKOUT_NOT_FOUND");
    }

    validateAmountAndCurrency({
      booking,
      amount: payload.amount,
      currency: payload.currency
    });

    return booking;
  }

  const prepared = await bookingsService.preparePendingPaymentBooking({
    payload: {
      ...payload,
      paymentMethod: payload.paymentMethod || "pesapal"
    },
    auth,
    requestId
  });

  return prepared.bookingDoc;
};

const buildBillingAddress = (customer = {}) => {
  const countryToken = String(customer.country || "").trim().toUpperCase();
  const countryCode = countryToken.length === 2 ? countryToken : "TZ";

  return {
    email_address: customer.email || "",
    phone_number: customer.phone || "",
    country_code: countryCode,
    first_name: customer.firstName || "",
    last_name: customer.lastName || ""
  };
};

const createOrderWithPesapal = async ({ booking, requestId }) => {
  const amount = toMoneyAmount(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
  const currency = normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");
  const merchantReference = buildPesapalOrderReference(booking.bookingReference);

  if (shouldMock) {
    const orderTrackingId = `MOCKPESAPAL-${Date.now()}`;
    return {
      orderTrackingId,
      merchantReference,
      redirectUrl: `${env.PESAPAL_SUCCESS_URL}?OrderTrackingId=${encodeURIComponent(orderTrackingId)}&OrderMerchantReference=${encodeURIComponent(merchantReference)}`,
      raw: {
        status_code: 1,
        status_description: "Mock order created"
      }
    };
  }

  const accessToken = await getPesapalAccessToken(requestId);
  const notificationId = await getPesapalNotificationId({
    accessToken,
    requestId
  });

  const response = await requestPesapal({
    method: "post",
    path: env.PESAPAL_SUBMIT_ORDER_PATH,
    payload: {
      id: merchantReference,
      currency,
      amount,
      description: `${booking.productTitle || "Tour booking"} (${booking.bookingReference})`,
      callback_url: env.PESAPAL_SUCCESS_URL,
      cancellation_url: env.PESAPAL_CANCEL_URL,
      // Explicitly return the customer to the React success page after payment.
      redirect_mode: "TOP_WINDOW",
      notification_id: notificationId,
      branch: "Zanzibar",
      billing_address: buildBillingAddress(booking.customer || {})
    },
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    requestId
  });

  const orderTrackingId = resolveOrderTrackingId(response);
  const resolvedMerchantReference = resolveMerchantReference(response) || merchantReference;
  const redirectUrl = resolveRedirectUrl(response);

  if (!orderTrackingId || !redirectUrl) {
    throw new AppError(
      "Pesapal order creation failed to return redirect details",
      502,
      "PESAPAL_CREATE_ORDER_FAILED",
      {
        response
      }
    );
  }

  return {
    orderTrackingId,
    merchantReference: resolvedMerchantReference,
    redirectUrl,
    raw: response
  };
};

const verifyOrderWithPesapal = async ({ orderTrackingId, requestId }) => {
  const trackingId = String(orderTrackingId || "").trim();
  if (!trackingId) {
    throw new AppError("OrderTrackingId is required", 400, "PESAPAL_ORDER_TRACKING_REQUIRED");
  }

  if (shouldMock) {
    const mockConfirmsPayment = Boolean(env.PESAPAL_MOCK_CONFIRMS_PAYMENT && env.BOKUN_MOCK_MODE);
    return {
      orderTrackingId: trackingId,
      providerOrderTrackingId: trackingId,
      merchantReference: "",
      status: mockConfirmsPayment ? "COMPLETED" : "PENDING",
      statusDescription: mockConfirmsPayment
        ? "Mock payment verified"
        : "Mock Pesapal payment is not treated as a real payment",
      amount: 0,
      currency: "USD",
      isPaid: mockConfirmsPayment,
      statusCode: mockConfirmsPayment ? 1 : 0,
      raw: {
        mock: true,
        canConfirmPayment: mockConfirmsPayment,
        status_code: mockConfirmsPayment ? 1 : 0
      }
    };
  }

  const accessToken = await getPesapalAccessToken(requestId);
  const response = await requestPesapal({
    method: "get",
    path: env.PESAPAL_STATUS_PATH,
    params: {
      orderTrackingId: trackingId
    },
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    requestId
  });

  const statusDescription = String(
    response?.payment_status_description ||
      response?.payment_status ||
      response?.status ||
      response?.status_description ||
      ""
  ).trim();

  const status = normalizePesapalStatus(statusDescription);
  const statusCode = resolvePesapalResponseStatusCode(response);
  const isPaid = isVerifiedPesapalPayment(response, status);

  return {
    orderTrackingId: trackingId,
    providerOrderTrackingId: resolveOrderTrackingId(response) || trackingId,
    merchantReference: resolveMerchantReference(response),
    status,
    statusDescription,
    statusCode,
    amount: Number(response?.amount || response?.amount_paid || 0),
    currency: normalizeCurrency(response?.currency || response?.currency_code || "USD"),
    isPaid,
    raw: response
  };
};

const updatePaymentLogForCreate = async ({ booking, orderResponse }) => {
  const providerResponse = {
    stage: "submit_order",
    response: orderResponse.raw || {}
  };

  const latestPayment = await paymentsService.findLatestPaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "pesapal"
  });

  if (latestPayment?.intentId && !["failed", "reversed", "refunded"].includes(String(latestPayment.status || "").toLowerCase())) {
    await paymentsService.updatePaymentStatus({
      intentId: latestPayment.intentId,
      status: "initiated",
      providerTransactionId: orderResponse.orderTrackingId,
      orderTrackingId: orderResponse.orderTrackingId,
      merchantReference: orderResponse.merchantReference,
      rawResponse: orderResponse.raw || {},
      providerResponse,
      event: "gateway_order_created",
      eventSource: "checkout",
      eventDescription: "Pesapal order created and ready for customer redirect"
    });
    return latestPayment;
  }

  const createdIntent = await paymentsService.createPaymentIntent({
    bookingReference: booking.bookingReference,
    customerId: booking.customer?.customerId || null,
    amount: Number(booking.amount || 0),
    currency: booking.currency || "USD",
    provider: "pesapal",
    providerTransactionId: orderResponse.orderTrackingId,
    orderTrackingId: orderResponse.orderTrackingId,
    merchantReference: orderResponse.merchantReference,
    notes: "Pesapal payment intent created"
  });

  if (createdIntent?.intentId) {
    const updated = await paymentsService.updatePaymentStatus({
      intentId: createdIntent.intentId,
      status: "initiated",
      providerTransactionId: orderResponse.orderTrackingId,
      orderTrackingId: orderResponse.orderTrackingId,
      merchantReference: orderResponse.merchantReference,
      rawResponse: orderResponse.raw || {},
      providerResponse,
      event: "gateway_order_created",
      eventSource: "checkout",
      eventDescription: "Pesapal order created and ready for customer redirect"
    });

    return updated || createdIntent;
  }

  return createdIntent;
};

const updatePaymentLogForVerification = async ({
  bookingReference,
  isPaid,
  amount,
  verification,
  orderTrackingId = "",
  merchantReference = "",
  source = "callback",
  localStatus = ""
}) => {
  const status = localStatus || (isPaid ? "paid" : "verification_error");
  const paidAmount = isPaid ? Number(amount || 0) : 0;
  const trackingId = orderTrackingId || verification.orderTrackingId || "";
  const paymentUpdate = {
    bookingReference,
    provider: "pesapal",
    status,
    paidAmount,
    amountPaid: paidAmount,
    providerTransactionId: trackingId,
    orderTrackingId: trackingId,
    merchantReference,
    paidAt: isPaid ? new Date() : undefined,
    lastVerifiedAt: new Date(),
    rawResponse: verification.raw || verification,
    ipnEvent: ["ipn", "callback"].includes(source)
      ? {
          source,
          orderTrackingId: orderTrackingId || verification.orderTrackingId || "",
          merchantReference,
          status: verification.status || "",
          raw: verification.raw || verification
        }
      : null,
    providerResponse: {
      stage: "get_transaction_status",
      response: verification.raw || verification
    },
    event: isPaid ? "payment_verified" : "payment_verification_updated",
    eventSource: source,
    eventDescription: verification.statusDescription || verification.status || "Pesapal transaction status checked",
    eventMetadata: {
      providerStatusCode: Number(verification.statusCode || 0) || null,
      providerStatus: verification.status || ""
    }
  };

  const updated = await paymentsService.updatePaymentByBookingReference(paymentUpdate);
  if (updated || !bookingReference) {
    return updated;
  }

  const created = await paymentsService.createPaymentIntent({
    bookingReference,
    customerId: null,
    amount: Number(amount || verification.amount || 0),
    currency: verification.currency || "USD",
    provider: "pesapal",
    providerTransactionId: trackingId,
    orderTrackingId: trackingId,
    merchantReference: merchantReference || bookingReference,
    notes: "Pesapal payment record recreated during verification"
  });

  if (!created?.intentId) {
    return created;
  }

  return paymentsService.updatePaymentStatus({
    intentId: created.intentId,
    ...paymentUpdate
  });
};

const markPesapalVerificationPending = async ({
  booking,
  verification,
  orderTrackingId = "",
  orderMerchantReference = "",
  source = "callback",
  requestId,
  reason = "Pesapal transaction status is not final yet"
}) => {
  const trackingId = String(orderTrackingId || booking.paymentTransactionId || "").trim();
  await updatePaymentLogForVerification({
    bookingReference: booking.bookingReference,
    isPaid: false,
    amount: 0,
    verification,
    orderTrackingId: trackingId,
    merchantReference: orderMerchantReference || booking.bookingReference,
    source,
    localStatus: "verification_error"
  });

  return bookingsService.markBookingPaymentState({
    bookingId: booking._id,
    requestId,
    paymentStatus: "verification_error",
    reason,
    transactionToken: trackingId,
    paymentMethod: "pesapal",
    bookingStatus: "pending",
    supplierStatus: "awaiting_payment"
  });
};

const resolveBookingByIdentifiers = async ({
  bookingId = "",
  orderTrackingId = "",
  orderMerchantReference = ""
} = {}) => {
  if (bookingId) {
    const booking = await Booking.findById(bookingId);
    if (booking) {
      return booking;
    }
  }

  const trackingToken = String(orderTrackingId || "").trim();
  if (trackingToken) {
    const byTracking = await Booking.findOne({
      $or: [
        { paymentTransactionId: trackingToken },
        { dpoTransactionToken: trackingToken }
      ]
    });
    if (byTracking) {
      return byTracking;
    }
  }

  const merchantReference = String(orderMerchantReference || "").trim();
  if (merchantReference) {
    return Booking.findOne({ bookingReference: merchantReference });
  }

  return null;
};

const createPayment = async ({ payload, auth, requestId }) => {
  ensurePesapalConfiguration();

  const booking = await resolveOrCreatePendingBooking({
    payload,
    auth,
    requestId
  });

  if (booking.paymentStatus === "paid") {
    return {
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      redirectUrl: "",
      paymentStatus: booking.paymentStatus,
      bookingStatus: booking.bookingStatus,
      message: booking.bokunBookingId
        ? "Booking already paid and confirmed"
        : "Payment already verified. Supplier confirmation is still processing."
    };
  }

  validateAmountAndCurrency({
    booking,
    amount: payload.amount,
    currency: payload.currency
  });

  const existingTrackingId = String(booking.paymentTransactionId || booking.dpoTransactionToken || "").trim();
  const existingRedirectUrl = resolveRedirectUrl(booking.pendingCheckout?.pesapalCreateOrderResult || {});
  if (
    existingTrackingId &&
    ["initiated", "processing", "pending", "verification_error"].includes(String(booking.paymentStatus || "").toLowerCase())
  ) {
    if (existingRedirectUrl) {
      return {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        orderTrackingId: existingTrackingId,
        merchantReference: booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference,
        redirectUrl: existingRedirectUrl,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
        message: "An existing Pesapal payment is still being verified."
      };
    }

    throw new AppError(
      "An existing Pesapal payment is still being verified. Please use the payment status page instead of starting another payment.",
      409,
      "PESAPAL_PAYMENT_IN_PROGRESS",
      { bookingReference: booking.bookingReference, orderTrackingId: existingTrackingId }
    );
  }

  const orderResponse = await createOrderWithPesapal({
    booking,
    requestId
  });

  booking.paymentTransactionId = orderResponse.orderTrackingId;
  booking.dpoTransactionToken = orderResponse.orderTrackingId;
  booking.paymentStatus = "initiated";
  booking.paymentMethod = "pesapal";
  booking.bookingStatus = booking.bokunBookingId ? booking.bookingStatus : "pending";
  booking.supplierStatus = booking.bokunBookingId ? "confirmed" : "awaiting_payment";
  booking.supplierStatusUpdatedAt = new Date();
  booking.pendingCheckout = {
    ...(booking.pendingCheckout || {}),
    pesapalInitializedAt: new Date().toISOString(),
    pesapalOrderTrackingId: orderResponse.orderTrackingId,
    pesapalMerchantReference: orderResponse.merchantReference,
    pesapalCreateOrderResult: orderResponse.raw || {},
    paymentInitiatedAt: new Date().toISOString()
  };
  await booking.save();

  await updatePaymentLogForCreate({
    booking,
    orderResponse
  });
  await notificationsService.notifyPaymentOrderCreated({
    booking,
    provider: "pesapal",
    requestId
  });

  logger.info("Pesapal payment order created", {
    requestId,
    bookingReference: booking.bookingReference,
    bookingId: booking._id.toString(),
    orderTrackingId: orderResponse.orderTrackingId
  });

  return {
    bookingId: booking._id,
    bookingReference: booking.bookingReference,
    orderTrackingId: orderResponse.orderTrackingId,
    merchantReference: orderResponse.merchantReference,
    redirectUrl: orderResponse.redirectUrl,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus
  };
};

// This is the one payment-to-supplier orchestration path. IPN, callback,
// customer status polling, and admin recovery all enter through this function.
const verifyAndProcessPesapalPayment = async ({
  orderTrackingId = "",
  orderMerchantReference = "",
  requestId,
  source = "callback"
}) => {
  ensurePesapalConfiguration();

  const booking = await resolveBookingByIdentifiers({
    orderTrackingId,
    orderMerchantReference
  });
  if (!booking) {
    throw new AppError("Booking not found for this payment callback", 404, "BOOKING_PAYMENT_REFERENCE_NOT_FOUND");
  }

  if (booking.paymentStatus === "paid" && booking.bokunBookingId) {
    return {
      status: "paid",
      alreadyProcessed: true,
      booking: toPaymentCallbackBooking(booking)
    };
  }

  const processingStaleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const processingLock = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      $or: [
        { "pendingCheckout.processing": { $ne: true } },
        { "pendingCheckout.processingAt": { $lte: processingStaleBefore } }
      ]
    },
    {
      $set: {
        "pendingCheckout.processing": true,
        "pendingCheckout.processingAt": new Date().toISOString()
      }
    },
    { new: true }
  );

  if (!processingLock) {
    const latest = await Booking.findById(booking._id);
    if (latest?.paymentStatus === "paid" && latest?.bokunBookingId) {
      return {
        status: "paid",
        alreadyProcessed: true,
        booking: toPaymentCallbackBooking(latest)
      };
    }

    return {
      status: latest?.paymentStatus === "paid" ? "paid_pending_finalization" : "processing",
      alreadyProcessing: true,
      message:
        latest?.paymentStatus === "paid"
          ? "Payment is verified. Supplier confirmation is still processing."
          : "Payment verification is already processing.",
      booking: toPaymentCallbackBooking(latest || booking)
    };
  }

  try {
    const trackingId = String(orderTrackingId || booking.paymentTransactionId || "").trim();
    const verification = await verifyOrderWithPesapal({
      orderTrackingId: trackingId,
      requestId
    });
    validatePesapalVerification({
      booking,
      verification,
      orderTrackingId: trackingId,
      orderMerchantReference
    });

    if (!verification.isPaid) {
      const paymentState = resolvePesapalPaymentState(verification.raw || verification, verification.status);
      const verificationMessage =
        verification.statusDescription ||
        "We are confirming your payment with Pesapal.";

      if (paymentState === "processing") {
        await updatePaymentLogForVerification({
          bookingReference: booking.bookingReference,
          isPaid: false,
          amount: 0,
          verification,
          orderTrackingId: trackingId,
          merchantReference: orderMerchantReference || booking.bookingReference,
          source,
          localStatus: "processing"
        });

        const processingBooking = await bookingsService.markBookingPaymentState({
          bookingId: booking._id,
          requestId,
          paymentStatus: "processing",
          reason: verificationMessage,
          transactionToken: trackingId,
          paymentMethod: "pesapal",
          bookingStatus: "pending",
          supplierStatus: "awaiting_payment"
        });

        return {
          status: "processing",
          message: "Payment is still being confirmed by Pesapal.",
          booking: toPaymentCallbackBooking(processingBooking)
        };
      }

      if (paymentState === "verification_error") {
        const pendingBooking = await markPesapalVerificationPending({
          booking,
          verification,
          orderTrackingId: trackingId,
          orderMerchantReference,
          source,
          requestId,
          reason: "Pesapal returned a non-final transaction response. Verification will retry automatically."
        });

        return {
          status: "processing",
          message: "We are still confirming your payment with Pesapal. You may safely keep this page open.",
          booking: toPaymentCallbackBooking(pendingBooking)
        };
      }

      if (paymentState === "reversed") {
        await updatePaymentLogForVerification({
          bookingReference: booking.bookingReference,
          isPaid: false,
          amount: 0,
          verification,
          orderTrackingId: trackingId,
          merchantReference: orderMerchantReference || booking.bookingReference,
          source,
          localStatus: "reversed"
        });

        const reversedBooking = await bookingsService.markBookingPaymentState({
          bookingId: booking._id,
          requestId,
          paymentStatus: "reversed",
          reason: verificationMessage,
          transactionToken: trackingId,
          paymentMethod: "pesapal",
          bookingStatus: "pending",
          supplierStatus: "awaiting_payment"
        });

        return {
          status: "reversed",
          message: "Payment was reversed by the payment provider.",
          booking: toPaymentCallbackBooking(reversedBooking)
        };
      }

      const failedBooking = await bookingsService.markBookingPaymentFailed({
        bookingId: booking._id,
        requestId,
        reason: verificationMessage,
        transactionToken: trackingId,
        paymentMethod: "pesapal"
      });

      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification,
        orderTrackingId: trackingId,
        merchantReference: orderMerchantReference || booking.bookingReference,
        source,
        localStatus: "failed"
      });
      await notificationsService.notifyPaymentFailed({
        booking,
        provider: "pesapal",
        requestId,
        reason: verificationMessage
      });

      return {
        status: "failed",
        message: "Your payment could not be authorized. Please try again or use another payment method.",
        booking: toPaymentCallbackBooking(failedBooking)
      };
    }

    const paidAmount = Number(verification.amount || booking.amount || 0);
    const merchantReference =
      verification.merchantReference ||
      orderMerchantReference ||
      booking.pendingCheckout?.pesapalMerchantReference ||
      booking.bookingReference;
    await updatePaymentLogForVerification({
      bookingReference: booking.bookingReference,
      isPaid: true,
      amount: paidAmount,
      verification,
      orderTrackingId: trackingId,
      merchantReference,
      source
    });

    const needsPaymentReconciliation = booking.paymentStatus !== "paid" || !isInvoiceReconciledPaid(booking);
    const paidBooking = needsPaymentReconciliation
      ? await bookingsService.markBookingPaymentVerified({
          bookingId: booking._id,
          requestId,
          transactionToken: trackingId,
          paymentMethod: "pesapal",
          paymentProvider: "pesapal",
          amountPaid: paidAmount,
          currency: verification.currency || booking.currency || "USD",
          reason: "Pesapal payment verified before Bokun finalization"
        })
      : booking;

    if (paidBooking.bokunBookingId) {
      return {
        status: "paid",
        alreadyProcessed: true,
        message: "Payment verified and booking confirmed in Bokun",
        booking: toPaymentCallbackBooking(paidBooking)
      };
    }

    const currentFinalization = paidBooking.pendingCheckout?.finalization || {};
    if (String(currentFinalization.status || "").toLowerCase() === "failed") {
      return {
        status: "paid_manual_review",
        message: "Payment is confirmed. Supplier confirmation needs support review.",
        booking: toPaymentCallbackBooking(paidBooking)
      };
    }

    if (!isFinalizationRetryDue(paidBooking)) {
      return {
        status: "paid_pending_finalization",
        message: "Payment is verified. Supplier confirmation is scheduled to retry automatically.",
        booking: toPaymentCallbackBooking(paidBooking)
      };
    }

    const finalized = await bookingsService.finalizePendingBookingAfterPayment({
      bookingId: booking._id,
      transactionToken: trackingId,
      paymentMethod: "pesapal",
      paymentProvider: "pesapal",
      requestId,
      auditReason: "Pesapal payment verified and booking created in Bokun"
    });
    if (needsPaymentReconciliation) {
      await notificationsService.notifyPaymentVerified({
        booking: finalized.booking || paidBooking,
        provider: "pesapal",
        requestId
      });
    }

    const finalizedBooking = finalized.booking || paidBooking;
    const isConfirmed =
      Boolean(finalizedBooking?.bokunBookingId) && String(finalizedBooking?.bookingStatus || "").toLowerCase() === "confirmed";

    return {
      status: isConfirmed ? "paid" : "paid_pending_finalization",
      message: isConfirmed
        ? "Payment verified and booking confirmed in Bokun"
        : "Payment verified. Supplier confirmation is still processing.",
      booking: finalized.response || toPaymentCallbackBooking(finalizedBooking)
    };
  } catch (error) {
    const finalizationMeta = extractBokunFinalizationErrorMeta(error);
    const isPendingFinalization = isBokunFinalizationPendingError(error);
    const bookingAfterError = await Booking.findById(booking._id);
    const paymentWasVerified = bookingAfterError?.paymentStatus === "paid";
    const isSecurityError = isPesapalVerificationSecurityError(error);

    if (!paymentWasVerified && isSecurityError) {
      // Never let a mismatched callback alter the local payment state. It may
      // be an invalid request while the legitimate provider verification is
      // still in flight.
      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification,
        orderTrackingId: booking.paymentTransactionId || orderTrackingId || "",
        merchantReference:
          verification?.merchantReference ||
          orderMerchantReference ||
          booking.pendingCheckout?.pesapalMerchantReference ||
          booking.bookingReference,
        source,
        localStatus: "verification_error"
      });

      logger.warn("Pesapal verification rejected due to a security mismatch", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        errorCode: error.code,
        mismatch: error.details || null
      });
      throw error;
    }

    if (!paymentWasVerified) {
      logger.warn("Pesapal verification is temporarily unavailable", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        errorCode: error.code
      });

      const pendingBooking = await markPesapalVerificationPending({
        booking,
        verification: {
          status: "VERIFICATION_ERROR",
          statusDescription: "Pesapal status verification is temporarily unavailable",
          raw: { code: error.code || "PESAPAL_API_REQUEST_FAILED" }
        },
        orderTrackingId: booking.paymentTransactionId || orderTrackingId || "",
        orderMerchantReference,
        source,
        requestId,
        reason: "Pesapal status verification is temporarily unavailable"
      });

      return {
        status: "processing",
        message: "We are confirming your payment with Pesapal. You may safely close this page while we continue checking.",
        booking: toPaymentCallbackBooking(pendingBooking)
      };
    }

    if (bookingAfterError) {
      if (isPendingFinalization) {
        bookingAfterError.bookingStatus = bookingAfterError.bokunBookingId
          ? bookingAfterError.bookingStatus
          : "pending";
        bookingAfterError.paymentStatus = "paid";
      } else if (bookingAfterError.paymentStatus !== "paid") {
        bookingAfterError.bookingStatus = "failed";
        bookingAfterError.paymentStatus = "failed";
      }

      bookingAfterError.pendingCheckout = {
        ...(bookingAfterError.pendingCheckout || {}),
        finalizationErrorAt: new Date().toISOString(),
        finalizationError: finalizationMeta.message,
        finalizationErrorCode: finalizationMeta.code,
        finalizationErrorStatusCode: finalizationMeta.statusCode || null,
        finalizationPending: isPendingFinalization,
        finalizationAttempts:
          finalizationMeta.attempts.length > 0
            ? finalizationMeta.attempts
            : bookingAfterError.pendingCheckout?.finalizationAttempts || []
      };
      await bookingAfterError.save();
    }

    // A verified Pesapal response is immutable evidence of payment. Do not
    // replace it with a later Bókun error while reconciling supplier status.
    if (!paymentWasVerified) {
      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification: {
          status: "FINALIZATION_ERROR",
          statusDescription: finalizationMeta.message,
          raw: {
            error: finalizationMeta.message,
            code: finalizationMeta.code,
            statusCode: finalizationMeta.statusCode,
            attempts: finalizationMeta.attempts
          }
        },
        orderTrackingId: booking.paymentTransactionId || orderTrackingId || "",
        merchantReference: orderMerchantReference || booking.bookingReference,
        source
      });
    }

    if (paymentWasVerified && isPendingFinalization) {
      logger.warn("Payment verified but Bokun finalization is pending", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        errorCode: finalizationMeta.code,
        statusCode: finalizationMeta.statusCode
      });
      await notificationsService.notifyBokunPending({
        booking: bookingAfterError || booking,
        provider: "pesapal",
        requestId,
        error: finalizationMeta.message
      });

      return {
        status: "paid_pending_finalization",
        message:
          "Payment verified. Bokun confirmation is pending due to a temporary sync issue. Please retry shortly.",
        booking: toPaymentCallbackBooking(bookingAfterError || booking)
      };
    }

    if (paymentWasVerified) {
      logger.error("Payment verified but Bokun finalization requires review", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        errorCode: finalizationMeta.code,
        statusCode: finalizationMeta.statusCode
      });

      return {
        status: "paid_manual_review",
        message: "Payment is confirmed. Supplier confirmation needs support review.",
        booking: toPaymentCallbackBooking(bookingAfterError || booking)
      };
    }

    return {
      status: "failed",
      message: finalizationMeta.message || "Payment verification failed before Bokun confirmation",
      booking: toPaymentCallbackBooking(bookingAfterError || booking)
    };
  } finally {
    await Booking.findByIdAndUpdate(booking._id, {
      $set: {
        "pendingCheckout.processing": false,
        "pendingCheckout.processingCompletedAt": new Date().toISOString()
      }
    });
  }
};

const recheckPaymentByBookingReference = async ({
  bookingReference = "",
  requestId = "",
  source = "admin_recheck"
} = {}) => {
  const booking = await Booking.findOne({ bookingReference: String(bookingReference || "") });
  if (!booking) {
    throw new AppError("Booking not found for this payment", 404, "BOOKING_PAYMENT_REFERENCE_NOT_FOUND");
  }

  const trackingId = String(booking.paymentTransactionId || booking.dpoTransactionToken || "").trim();
  if (!trackingId) {
    throw new AppError("Pesapal order tracking ID is missing for this booking", 409, "PESAPAL_ORDER_TRACKING_MISSING");
  }

  const result = await verifyAndProcessPesapalPayment({
    orderTrackingId: trackingId,
    orderMerchantReference: booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference,
    requestId,
    source
  });

  return {
    ...result,
    paymentVerified: ["paid", "paid_pending_finalization", "paid_manual_review"].includes(result.status),
    bookingReference: booking.bookingReference,
    orderTrackingId: trackingId
  };
};

const getCustomerPaymentStatus = async ({
  orderTrackingId = "",
  orderMerchantReference = "",
  requestId = ""
} = {}) => {
  const result = await verifyAndProcessPesapalPayment({
    orderTrackingId,
    orderMerchantReference,
    requestId,
    source: "customer_status"
  });
  const bookingId = result?.booking?.bookingId || "";
  const booking = bookingId
    ? await Booking.findById(bookingId)
    : await resolveBookingByIdentifiers({ orderTrackingId, orderMerchantReference });

  if (!booking) {
    throw new AppError("Payment status could not be found", 404, "PAYMENT_STATUS_NOT_FOUND");
  }

  return buildCustomerPaymentStatus({
    booking,
    status: result.status,
    message: result.message
  });
};

const handlePaymentCancel = async ({
  orderTrackingId = "",
  orderMerchantReference = "",
  bookingId = "",
  requestId
}) => {
  const booking = await resolveBookingByIdentifiers({
    bookingId,
    orderTrackingId,
    orderMerchantReference
  });

  if (!booking) {
    return {
      status: "cancelled",
      message: "Payment cancelled"
    };
  }

  // A cancellation redirect only indicates that the browser left Pesapal. It
  // is not proof of failure: always verify the transaction before changing
  // either payment or booking state.
  const trackingId = String(orderTrackingId || booking.paymentTransactionId || "").trim();
  if (!trackingId) {
    return {
      status: "processing",
      message: "We could not identify the payment yet. Please return to the payment status page shortly.",
      booking: toPaymentCallbackBooking(booking)
    };
  }

  return verifyAndProcessPesapalPayment({
    orderTrackingId: trackingId,
    orderMerchantReference: orderMerchantReference || booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference,
    requestId,
    source: "cancel_callback"
  });
};

module.exports = {
  createPayment,
  verifyAndProcessPesapalPayment,
  // Backward-compatible alias for callers that have not been deployed yet.
  verifyAndReconcilePesapalPayment: verifyAndProcessPesapalPayment,
  handlePaymentSuccess: verifyAndProcessPesapalPayment,
  handlePaymentCancel,
  recheckPaymentByBookingReference,
  getCustomerPaymentStatus,
  __testables: {
    validatePesapalVerification
  }
};

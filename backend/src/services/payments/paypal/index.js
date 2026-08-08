const axios = require("axios");
const Booking = require("../../../models/Booking");
const logger = require("../../../config/logger");
const { env, isPaypalConfigured } = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const bookingsService = require("../../bookings");
const paymentsService = require("..");
const notificationsService = require("../../notifications");
const { normalizePaypalPayment } = require("../providerNormalization");
const {
  decimalString,
  decimalToApi,
  equalsWithin,
  isPositive,
  moneyString,
  normalizeCurrency
} = require("../../../utils/money");
const { isLocalOrPrivateRedirectUrl } = require("../../../integrations/dpo/dpo.utils");

const paypalClient = axios.create({
  baseURL: env.PAYPAL_BASE_URL,
  timeout: env.PAYPAL_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json"
  }
});

const shouldMock = Boolean(env.PAYPAL_MOCK_MODE);

const authTokenCache = {
  token: "",
  expiresAt: 0
};

const toMoneyAmount = (value = 0) => {
  try {
    return moneyString(value, 2);
  } catch (error) {
    return "0.00";
  }
};

const areLiveRedirectsLocal = () =>
  isLocalOrPrivateRedirectUrl(env.PAYPAL_SUCCESS_URL) ||
  isLocalOrPrivateRedirectUrl(env.PAYPAL_CANCEL_URL);

const ensurePaypalConfiguration = () => {
  if (shouldMock) {
    return;
  }

  if (!isPaypalConfigured) {
    throw new AppError(
      "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, or enable PAYPAL_MOCK_MODE=true.",
      503,
      "PAYPAL_NOT_CONFIGURED"
    );
  }

  if (!env.PAYPAL_ALLOW_LOCAL_REDIRECTS && areLiveRedirectsLocal()) {
    throw new AppError(
      "PayPal live mode requires public redirect URLs. Localhost/127.0.0.1 redirects are blocked.",
      422,
      "PAYPAL_INVALID_REDIRECT_URLS",
      {
        PAYPAL_SUCCESS_URL: env.PAYPAL_SUCCESS_URL,
        PAYPAL_CANCEL_URL: env.PAYPAL_CANCEL_URL
      }
    );
  }
};

const ensurePaypalWebhookConfiguration = () => {
  ensurePaypalConfiguration();

  if (!shouldMock && !String(env.PAYPAL_WEBHOOK_ID || "").trim()) {
    throw new AppError(
      "PayPal webhook is not configured. Set PAYPAL_WEBHOOK_ID before accepting live webhook events.",
      503,
      "PAYPAL_WEBHOOK_NOT_CONFIGURED"
    );
  }
};

const requestPaypal = async ({
  method = "get",
  path = "/",
  payload = undefined,
  headers = {},
  auth = undefined,
  requestId = ""
} = {}) => {
  try {
    const { data } = await paypalClient.request({
      method,
      url: path,
      data: payload,
      headers: {
        ...(requestId ? { "x-request-id": requestId } : {}),
        ...headers
      },
      auth
    });

    return data;
  } catch (error) {
    const statusCode = Number(error.response?.status || 502);
    const responseData = error.response?.data || {};
    const responsePreview =
      typeof responseData === "string"
        ? responseData.slice(0, 500)
        : JSON.stringify(responseData).slice(0, 500);

    throw new AppError(
      `PayPal API request failed: ${error.message || "unknown error"}`,
      502,
      "PAYPAL_API_REQUEST_FAILED",
      {
        statusCode,
        paypalPath: path,
        responsePreview,
        requestId
      }
    );
  }
};

const getPaypalAccessToken = async (requestId = "") => {
  if (shouldMock) {
    return "MOCK_PAYPAL_ACCESS_TOKEN";
  }

  if (authTokenCache.token && Date.now() + 60 * 1000 < authTokenCache.expiresAt) {
    return authTokenCache.token;
  }

  const response = await requestPaypal({
    method: "post",
    path: "/v1/oauth2/token",
    payload: "grant_type=client_credentials",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    auth: {
      username: env.PAYPAL_CLIENT_ID,
      password: env.PAYPAL_CLIENT_SECRET
    },
    requestId
  });

  const token = String(response?.access_token || "").trim();
  if (!token) {
    throw new AppError("PayPal token response is missing access token", 502, "PAYPAL_TOKEN_MISSING", {
      response
    });
  }

  const expiresIn = Number(response?.expires_in || 0);
  authTokenCache.token = token;
  authTokenCache.expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;

  return token;
};

const paypalHeader = (headers = {}, name = "") => {
  const normalizedName = String(name || "").toLowerCase();
  const match = Object.entries(headers).find(([key]) => String(key).toLowerCase() === normalizedName);
  return String(match?.[1] || "").trim();
};

const verifyWebhookSignature = async ({ headers = {}, event = {}, requestId = "" } = {}) => {
  ensurePaypalWebhookConfiguration();

  if (shouldMock) {
    return true;
  }

  const payload = {
    transmission_id: paypalHeader(headers, "paypal-transmission-id"),
    transmission_time: paypalHeader(headers, "paypal-transmission-time"),
    cert_url: paypalHeader(headers, "paypal-cert-url"),
    auth_algo: paypalHeader(headers, "paypal-auth-algo"),
    transmission_sig: paypalHeader(headers, "paypal-transmission-sig"),
    webhook_id: String(env.PAYPAL_WEBHOOK_ID || "").trim(),
    webhook_event: event
  };

  const missingHeaders = Object.entries(payload)
    .filter(([key, value]) => key !== "webhook_event" && !value)
    .map(([key]) => key);
  if (missingHeaders.length) {
    throw new AppError(
      "PayPal webhook signature headers are missing",
      401,
      "PAYPAL_WEBHOOK_HEADERS_MISSING",
      { missingHeaders }
    );
  }

  const accessToken = await getPaypalAccessToken(requestId);
  const verification = await requestPaypal({
    method: "post",
    path: "/v1/notifications/verify-webhook-signature",
    payload,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    requestId
  });

  if (String(verification?.verification_status || "").toUpperCase() !== "SUCCESS") {
    throw new AppError("PayPal webhook signature is invalid", 401, "PAYPAL_WEBHOOK_SIGNATURE_INVALID", {
      verificationStatus: verification?.verification_status || "unknown"
    });
  }

  return true;
};

const validateAmountAndCurrency = ({ booking, amount, currency }) => {
  if (!booking) {
    throw new AppError("Booking is required", 400, "BOOKING_REQUIRED");
  }

  const expectedAmount = decimalString(booking.amount || booking.pricingSnapshot?.finalPayable || 0, {
    allowNegative: false,
    field: "orderAmount"
  });
  const expectedCurrency = normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");
  if (expectedCurrency !== "USD") {
    throw new AppError("PayPal checkout supports USD only for this merchant.", 422, "PAYPAL_CURRENCY_NOT_SUPPORTED");
  }

  if (amount !== undefined && amount !== null) {
    if (!equalsWithin(amount, expectedAmount, env.PAYMENT_SAME_CURRENCY_TOLERANCE)) {
      throw new AppError("Amount mismatch with booking quote", 409, "PAYMENT_AMOUNT_MISMATCH");
    }
  }

  if (currency && normalizeCurrency(currency) !== expectedCurrency) {
    throw new AppError("Currency mismatch with booking quote", 409, "PAYMENT_CURRENCY_MISMATCH");
  }
};

const validatePaypalVerification = ({ booking, payment = null, verification }) => {
  const normalized = normalizePaypalPayment(verification);
  const expectedOrderId = String(payment?.paypalOrderId || payment?.orderTrackingId || booking?.paymentTransactionId || "").trim();
  const returnedOrderId = String(normalized.paypalOrderId || verification.orderId || "").trim();
  const expectedReference = String(payment?.merchantReference || booking?.bookingReference || "").trim();
  const orderAmount = decimalToApi(payment?.orderAmount) || decimalString(booking?.amount || booking?.pricingSnapshot?.finalPayable || 0);
  const orderCurrency = normalizeCurrency(payment?.orderCurrency || booking?.currency || booking?.pricingSnapshot?.currency || "USD");

  if (!expectedOrderId || !returnedOrderId || expectedOrderId !== returnedOrderId) {
    throw new AppError("PayPal order ID does not match this payment attempt", 409, "PAYPAL_REFERENCE_MISMATCH");
  }

  let verificationStatus = "verified";
  let verificationReason = "PayPal completed capture matched the immutable USD payment attempt";
  if (!expectedReference || !normalized.merchantReference || expectedReference !== normalized.merchantReference) {
    verificationStatus = "reference_mismatch";
    verificationReason = "PayPal custom/reference ID does not match the booking";
  } else if (!normalized.confirmationOrCaptureReference) {
    verificationStatus = "reference_mismatch";
    verificationReason = "PayPal completed response is missing the capture ID";
  } else if (orderCurrency !== "USD" || normalized.chargedCurrency !== "USD") {
    verificationStatus = "currency_review_required";
    verificationReason = "PayPal capture currency must be USD for this merchant";
  } else if (!normalized.hasValidChargedMoney || !isPositive(orderAmount)) {
    verificationStatus = "amount_mismatch";
    verificationReason = "PayPal capture amount is missing or non-positive";
  } else if (!equalsWithin(normalized.chargedAmount, orderAmount, env.PAYMENT_SAME_CURRENCY_TOLERANCE)) {
    verificationStatus = "amount_mismatch";
    verificationReason = "PayPal captured amount does not match the immutable order amount";
  }

  return {
    normalized,
    accountingAmount: orderAmount,
    accountingCurrency: orderCurrency,
    providerAmount: normalized.chargedAmount,
    providerCurrency: normalized.chargedCurrency,
    verificationStatus,
    verificationReason,
    canAllocate: verificationStatus === "verified"
  };
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
      paymentMethod: payload.paymentMethod || "paypal"
    },
    auth,
    requestId
  });

  return prepared.bookingDoc;
};

const createOrderWithPaypal = async ({ booking, requestId }) => {
  const amount = toMoneyAmount(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
  const currency = normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");
  if (currency !== "USD") {
    throw new AppError("PayPal checkout supports USD only for this merchant.", 422, "PAYPAL_CURRENCY_NOT_SUPPORTED");
  }

  if (shouldMock) {
    const orderId = `MOCKPAYPAL-${Date.now()}`;
    return {
      orderId,
      redirectUrl: `${env.PAYPAL_SUCCESS_URL}?token=${encodeURIComponent(orderId)}`,
      raw: {
        id: orderId,
        status: "CREATED",
        mock: true
      }
    };
  }

  const accessToken = await getPaypalAccessToken(requestId);
  const response = await requestPaypal({
    method: "post",
    path: "/v2/checkout/orders",
    payload: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: booking.bookingReference,
          custom_id: booking.bookingReference,
          description: `${booking.productTitle || "Tour booking"} (${booking.bookingReference})`,
          amount: {
            currency_code: currency,
            value: amount
          }
        }
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Riser Tours & Safaris",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            return_url: env.PAYPAL_SUCCESS_URL,
            cancel_url: env.PAYPAL_CANCEL_URL
          }
        }
      }
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "PayPal-Request-Id": `create-${booking.bookingReference}`
    },
    requestId
  });

  const orderId = String(response?.id || "").trim();
  const approveLink = (response?.links || []).find((link) => String(link.rel || "").toLowerCase() === "payer-action") ||
    (response?.links || []).find((link) => String(link.rel || "").toLowerCase() === "approve");
  const redirectUrl = String(approveLink?.href || "").trim();

  if (!orderId || !redirectUrl) {
    throw new AppError("PayPal order creation failed to return approval details", 502, "PAYPAL_CREATE_ORDER_FAILED", {
      response
    });
  }

  return {
    orderId,
    redirectUrl,
    raw: response
  };
};

const captureOrderWithPaypal = async ({
  orderId,
  bookingReference = "",
  orderAmount = 0,
  orderCurrency = "USD",
  requestId = ""
} = {}) => {
  const token = String(orderId || "").trim();
  if (!token) {
    throw new AppError("PayPal order ID is required", 400, "PAYPAL_ORDER_ID_REQUIRED");
  }

  if (shouldMock) {
    const mockPaid = Boolean(env.PAYPAL_MOCK_CONFIRMS_PAYMENT && env.BOKUN_MOCK_MODE);
    const captureId = mockPaid ? `MOCKCAPTURE-${Date.now()}` : "";
    const amount = mockPaid ? toMoneyAmount(orderAmount) : "0.00";
    const currency = normalizeCurrency(orderCurrency || "USD") || "USD";
    return {
      orderId: token,
      status: mockPaid ? "COMPLETED" : "PENDING",
      isPaid: mockPaid,
      amount,
      currency,
      captureId,
      raw: {
        id: token,
        status: mockPaid ? "COMPLETED" : "PENDING",
        purchase_units: [
          {
            reference_id: bookingReference,
            custom_id: bookingReference,
            payments: {
              captures: [
                {
                  id: captureId,
                  status: mockPaid ? "COMPLETED" : "PENDING",
                  amount: {
                    value: amount,
                    currency_code: currency
                  },
                  create_time: new Date().toISOString()
                }
              ]
            }
          }
        ],
        mock: true
      }
    };
  }

  const accessToken = await getPaypalAccessToken(requestId);
  const response = await requestPaypal({
    method: "post",
    path: `/v2/checkout/orders/${encodeURIComponent(token)}/capture`,
    payload: {},
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
      "PayPal-Request-Id": `capture-${bookingReference || token}`
    },
    requestId
  });

  const capture =
    response?.purchase_units?.[0]?.payments?.captures?.[0] ||
    response?.payment_source?.paypal ||
    {};
  const amount = capture?.amount || response?.purchase_units?.[0]?.amount || {};
  const status = String(response?.status || capture?.status || "").toUpperCase();

  return {
    orderId: token,
    status,
    isPaid: status === "COMPLETED",
    amount: amount.value ?? "",
    currency: String(amount.currency_code || "").toUpperCase(),
    captureId: String(capture.id || ""),
    raw: response
  };
};

const refundCapturedPayment = async ({
  captureId = "",
  amount = 0,
  currency = "USD",
  idempotencyKey = "",
  invoiceNumber = "",
  note = "",
  requestId = ""
} = {}) => {
  ensurePaypalConfiguration();
  const token = String(captureId || "").trim();
  if (!token) {
    throw new AppError("PayPal capture ID is required before refunding.", 422, "PAYPAL_CAPTURE_ID_REQUIRED");
  }

  const refundAmount = toMoneyAmount(amount);
  const refundCurrency = String(currency || "USD").toUpperCase();
  const requestKey = String(idempotencyKey || `refund-${token}-${refundAmount}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 78);

  if (shouldMock) {
    const status = "COMPLETED";
    const refundId = `MOCK-PP-RFD-${Date.now()}`;
    return {
      provider: "paypal",
      status,
      providerRefundReference: refundId,
      requestedAmount: Number(refundAmount),
      confirmedAmount: status === "COMPLETED" ? Number(refundAmount) : 0,
      currency: refundCurrency,
      request: {
        captureId: token,
        amount: refundAmount,
        currency: refundCurrency,
        idempotencyKey: requestKey
      },
      response: {
        id: refundId,
        status,
        mock: true
      }
    };
  }

  const accessToken = await getPaypalAccessToken(requestId);
  const payload = {
    amount: {
      value: refundAmount,
      currency_code: refundCurrency
    },
    invoice_id: String(invoiceNumber || "").slice(0, 127),
    note_to_payer: String(note || "Riser Tours & Safaris Zanzibar cancellation refund.").slice(0, 255)
  };
  const response = await requestPaypal({
    method: "post",
    path: `/v2/payments/captures/${encodeURIComponent(token)}/refund`,
    payload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
      "PayPal-Request-Id": requestKey
    },
    requestId
  });

  const status = String(response?.status || "").toUpperCase();
  const responseAmount = response?.amount || {};
  const confirmedAmount = status === "COMPLETED"
    ? Number(responseAmount.value || refundAmount)
    : 0;

  return {
    provider: "paypal",
    status: status || "VERIFICATION_REQUIRED",
    providerRefundReference: String(response?.id || "").trim(),
    requestedAmount: Number(refundAmount),
    confirmedAmount,
    currency: String(responseAmount.currency_code || refundCurrency).toUpperCase(),
    request: {
      captureId: token,
      amount: refundAmount,
      currency: refundCurrency,
      idempotencyKey: requestKey
    },
    response
  };
};

const getRefundDetails = async ({ refundId = "", requestId = "" } = {}) => {
  ensurePaypalConfiguration();
  const token = String(refundId || "").trim();
  if (!token) {
    throw new AppError("PayPal refund ID is required before verification.", 422, "PAYPAL_REFUND_ID_REQUIRED");
  }

  if (shouldMock) {
    return {
      provider: "paypal",
      status: "COMPLETED",
      providerRefundReference: token,
      confirmedAmount: 0,
      currency: "USD",
      refundedAt: new Date().toISOString(),
      raw: {
        id: token,
        status: "COMPLETED",
        mock: true
      }
    };
  }

  const accessToken = await getPaypalAccessToken(requestId);
  const response = await requestPaypal({
    method: "get",
    path: `/v2/payments/refunds/${encodeURIComponent(token)}`,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    requestId
  });
  const responseAmount = response?.amount || {};

  return {
    provider: "paypal",
    status: String(response?.status || "").toUpperCase(),
    providerRefundReference: String(response?.id || token).trim(),
    confirmedAmount: Number(responseAmount.value || 0),
    currency: String(responseAmount.currency_code || "").toUpperCase(),
    refundedAt: response?.update_time || response?.create_time || null,
    failureReason: response?.status_details?.reason || "",
    raw: response
  };
};

const updatePaymentLogForCreate = async ({ booking, orderResponse }) => {
  const providerResponse = {
    stage: "create_order",
    response: orderResponse.raw || {}
  };

  const latestPayment = await paymentsService.findLatestPaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "paypal"
  });

  if (latestPayment?.intentId && !["failed", "reversed", "refunded"].includes(String(latestPayment.status || "").toLowerCase())) {
    await paymentsService.updatePaymentStatus({
      intentId: latestPayment.intentId,
      status: "pending",
      providerTransactionId: orderResponse.orderId,
      orderTrackingId: orderResponse.orderId,
      merchantReference: booking.bookingReference,
      rawResponse: orderResponse.raw || {},
      providerResponse,
      orderAmount: booking.amount || booking.pricingSnapshot?.finalPayable || 0,
      orderCurrency: "USD",
      paypalOrderId: orderResponse.orderId,
      providerStatus: "CREATED",
      verificationStatus: "pending",
      verificationReason: "Awaiting completed PayPal capture",
      accountingAllocationStatus: "pending"
    });
    return latestPayment;
  }

  const createdIntent = await paymentsService.createPaymentIntent({
    bookingReference: booking.bookingReference,
    customerId: booking.customer?.customerId || null,
    amount: Number(booking.amount || 0),
    currency: booking.currency || "USD",
    provider: "paypal",
    providerTransactionId: orderResponse.orderId,
    orderTrackingId: orderResponse.orderId,
    merchantReference: booking.bookingReference,
    notes: "PayPal payment intent created"
  });

  if (createdIntent?.intentId) {
    const updated = await paymentsService.updatePaymentStatus({
      intentId: createdIntent.intentId,
      status: "pending",
      providerTransactionId: orderResponse.orderId,
      orderTrackingId: orderResponse.orderId,
      merchantReference: booking.bookingReference,
      rawResponse: orderResponse.raw || {},
      providerResponse,
      orderAmount: booking.amount || booking.pricingSnapshot?.finalPayable || 0,
      orderCurrency: "USD",
      paypalOrderId: orderResponse.orderId,
      providerStatus: "CREATED",
      verificationStatus: "pending",
      verificationReason: "Awaiting completed PayPal capture",
      accountingAllocationStatus: "pending"
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
  localStatus = "",
  paymentVerification = null
}) => {
  const status = localStatus || (isPaid ? "paid" : "failed");
  const canAllocate = Boolean(isPaid && paymentVerification?.canAllocate);
  const paidAmount = canAllocate ? Number(amount || 0) : 0;
  const paymentUpdate = {
    bookingReference,
    provider: "paypal",
    status,
    paidAmount,
    amountPaid: paidAmount,
    providerTransactionId: verification.captureId || verification.orderId || "",
    orderTrackingId: verification.orderId || "",
    merchantReference: bookingReference,
    paidAt: isPaid ? new Date() : undefined,
    lastVerifiedAt: new Date(),
    rawResponse: verification.raw || verification,
    chargedAmount: paymentVerification?.providerAmount,
    chargedCurrency: paymentVerification?.providerCurrency,
    accountingAmount: paymentVerification?.accountingAmount,
    accountingCurrency: paymentVerification?.accountingCurrency,
    settlementAmount: paymentVerification?.normalized?.settlementAmount,
    settlementCurrency: paymentVerification?.normalized?.settlementCurrency || undefined,
    providerFeeAmount: paymentVerification?.normalized?.providerFeeAmount,
    providerFeeCurrency: paymentVerification?.normalized?.providerFeeCurrency || undefined,
    paymentMethod: paymentVerification?.normalized?.paymentMethod || "PayPal",
    paypalOrderId: verification.orderId || undefined,
    paypalCaptureId: verification.captureId || undefined,
    providerStatus: paymentVerification?.normalized?.providerStatus || verification.status || undefined,
    verificationStatus: paymentVerification?.verificationStatus || (isPaid ? "manual_review" : "pending"),
    verificationReason: paymentVerification?.verificationReason || "Awaiting completed PayPal capture",
    accountingAllocationStatus: isPaid ? (canAllocate ? "pending" : "blocked") : "pending",
    settlementFx: paymentVerification?.normalized?.reportedExchangeRate
      ? {
          rate: paymentVerification.normalized.reportedExchangeRate,
          sourceCurrency: paymentVerification.providerCurrency,
          targetCurrency: paymentVerification.normalized.settlementCurrency,
          source: "paypal_reported"
        }
      : undefined,
    bokunSyncStatus: "not_started",
    ipnEvent: {
      source: "callback",
      orderTrackingId: verification.orderId || "",
      merchantReference: bookingReference,
      status: verification.status || "",
      raw: verification.raw || verification
    },
    providerResponse: {
      stage: "capture_order",
      response: verification.raw || verification
    }
  };

  const updated = await paymentsService.updatePaymentByBookingReference(paymentUpdate);
  if (updated) {
    return updated;
  }

  const created = await paymentsService.createPaymentIntent({
    bookingReference,
    customerId: null,
    amount: Number(amount || 0),
    currency: paymentVerification?.accountingCurrency || "USD",
    orderAmount: paymentVerification?.accountingAmount || amount || 0,
    orderCurrency: paymentVerification?.accountingCurrency || "USD",
    provider: "paypal",
    providerTransactionId: verification.captureId || verification.orderId || "",
    orderTrackingId: verification.orderId || "",
    merchantReference: bookingReference,
    notes: "PayPal payment record recreated during verification"
  });

  if (!created?.intentId) {
    return created;
  }

  return paymentsService.updatePaymentStatus({
    intentId: created.intentId,
    ...paymentUpdate
  });
};

const resolveBookingByOrderId = async (orderId = "") => {
  const token = String(orderId || "").trim();
  if (!token) {
    return null;
  }

  return Booking.findOne({ paymentTransactionId: token });
};

const createPayment = async ({ payload, auth, requestId }) => {
  ensurePaypalConfiguration();

  const booking = await resolveOrCreatePendingBooking({
    payload,
    auth,
    requestId
  });

  if (booking.paymentStatus === "paid" && booking.bokunBookingId) {
    return {
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      redirectUrl: "",
      paymentStatus: booking.paymentStatus,
      bookingStatus: booking.bookingStatus,
      message: "Booking already paid and confirmed"
    };
  }

  validateAmountAndCurrency({
    booking,
    amount: payload.amount,
    currency: payload.currency
  });

  const orderResponse = await createOrderWithPaypal({
    booking,
    requestId
  });

  booking.paymentTransactionId = orderResponse.orderId;
  booking.paymentStatus = "pending";
  booking.paymentMethod = "paypal";
  booking.bookingStatus = booking.bokunBookingId ? booking.bookingStatus : "pending";
  booking.pendingCheckout = {
    ...(booking.pendingCheckout || {}),
    paypalInitializedAt: new Date().toISOString(),
    paypalOrderId: orderResponse.orderId,
    paypalRequestedAmount: decimalString(booking.amount || booking.pricingSnapshot?.finalPayable || 0),
    paypalRequestedCurrency: "USD",
    paypalCreateOrderResult: orderResponse.raw || {}
  };
  await booking.save();

  await updatePaymentLogForCreate({
    booking,
    orderResponse
  });
  await notificationsService.notifyPaymentOrderCreated({
    booking,
    provider: "paypal",
    requestId
  });

  logger.info("PayPal payment order created", {
    requestId,
    bookingReference: booking.bookingReference,
    bookingId: booking._id.toString(),
    paypalOrderId: orderResponse.orderId
  });

  return {
    bookingId: booking._id,
    bookingReference: booking.bookingReference,
    orderId: orderResponse.orderId,
    redirectUrl: orderResponse.redirectUrl,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus
  };
};

const handlePaymentSuccess = async ({ orderId = "", requestId = "" } = {}) => {
  ensurePaypalConfiguration();

  const booking = await resolveBookingByOrderId(orderId);
  if (!booking) {
    throw new AppError("Booking not found for this PayPal order", 404, "BOOKING_PAYMENT_REFERENCE_NOT_FOUND");
  }

  if (booking.paymentStatus === "paid" && booking.bokunBookingId) {
    return {
      status: "paid",
      alreadyProcessed: true,
      booking: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        bokunBookingId: booking.bokunBookingId,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
        sourceChannel: booking.sourceChannel || "direct_website",
        isAgentBooking: Boolean(booking.agentId)
      }
    };
  }

  if (booking.paymentStatus === "paid" && !booking.bokunBookingId) {
    try {
      const finalized = await bookingsService.finalizePendingBookingAfterPayment({
        bookingId: booking._id,
        transactionToken: String(booking.paymentTransactionId || ""),
        paymentMethod: "paypal",
        paymentProvider: "paypal",
        requestId,
        source: "paypal_callback_retry",
        auditReason: "PayPal payment already captured and Bokun finalization retried"
      });

      return {
        status: "paid",
        alreadyPaid: true,
        message: "Payment already captured and booking confirmed in Bokun",
        booking: finalized.response
      };
    } catch (error) {
      await notificationsService.notifyBokunPending({
        booking,
        provider: "paypal",
        requestId,
        error: error.message
      });

      return {
        status: "paid_pending_finalization",
        alreadyPaid: true,
        message: "Payment already captured. Supplier confirmation is still pending.",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "paid",
          bookingStatus: "pending",
          sourceChannel: booking.sourceChannel || "direct_website",
          isAgentBooking: Boolean(booking.agentId)
        }
      };
    }
  }

  const processingLock = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      "pendingCheckout.processing": { $ne: true }
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
        booking: {
          bookingId: latest._id,
          bookingReference: latest.bookingReference,
          bokunBookingId: latest.bokunBookingId,
          paymentStatus: latest.paymentStatus,
          bookingStatus: latest.bookingStatus,
          sourceChannel: latest.sourceChannel || "direct_website",
          isAgentBooking: Boolean(latest.agentId)
        }
      };
    }

    throw new AppError("Payment verification is already processing", 409, "PAYMENT_PROCESSING");
  }

  try {
    const verification = await captureOrderWithPaypal({
      orderId,
      bookingReference: booking.bookingReference,
      orderAmount: booking.amount || booking.pricingSnapshot?.finalPayable || 0,
      orderCurrency: booking.currency || booking.pricingSnapshot?.currency || "USD",
      requestId
    });

    if (!verification.isPaid) {
      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification,
        localStatus: "pending"
      });

      return {
        status: "pending",
        message: "PayPal payment has not completed yet.",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "pending",
          bookingStatus: booking.bookingStatus,
          sourceChannel: booking.sourceChannel || "direct_website",
          isAgentBooking: Boolean(booking.agentId)
        }
      };
    }

    const paymentAttempt = await paymentsService.findPaymentByGatewayIdentifiers({
      provider: "paypal",
      bookingReference: booking.bookingReference,
      orderTrackingId: orderId,
      merchantReference: booking.bookingReference
    });
    const paymentVerification = validatePaypalVerification({
      booking,
      payment: paymentAttempt,
      verification
    });
    const paidAmount = paymentVerification.accountingAmount;
    const verifiedPayment = await updatePaymentLogForVerification({
      bookingReference: booking.bookingReference,
      isPaid: true,
      amount: paidAmount,
      verification,
      paymentVerification
    });

    if (!paymentVerification.canAllocate) {
      await Booking.findByIdAndUpdate(booking._id, {
        $set: {
          paymentStatus: "processing",
          supplierStatus: "awaiting_payment",
          supplierStatusUpdatedAt: new Date(),
          "pendingCheckout.paymentReview.status": paymentVerification.verificationStatus,
          "pendingCheckout.paymentReview.reason": paymentVerification.verificationReason,
          "pendingCheckout.paymentReview.updatedAt": new Date().toISOString()
        }
      });
      return {
        status: "paid_manual_review",
        reconciliationRequired: true,
        message: "Payment was captured and is being reconciled. Please do not pay again.",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "processing",
          bookingStatus: booking.bookingStatus,
          sourceChannel: booking.sourceChannel || "direct_website",
          isAgentBooking: Boolean(booking.agentId)
        }
      };
    }

    await paymentsService.applyVerifiedPaymentAllocation({
      paymentId: verifiedPayment?._id,
      bookingReference: booking.bookingReference,
      metadata: { provider: "paypal", source: "paypal_capture", requestId }
    });

    const paidBooking = await bookingsService.markBookingPaymentVerified({
      bookingId: booking._id,
      requestId,
      transactionToken: verification.captureId || orderId,
      paymentMethod: "paypal",
      paymentProvider: "paypal",
      amountPaid: paidAmount,
      currency: paymentVerification.accountingCurrency,
      reason: "PayPal payment captured before Bokun finalization"
    });

    const finalized = await bookingsService.finalizePendingBookingAfterPayment({
      bookingId: booking._id,
      transactionToken: verification.captureId || orderId,
      paymentMethod: "paypal",
      paymentProvider: "paypal",
      requestId,
      source: "paypal_callback",
      auditReason: "PayPal payment captured and booking created in Bokun"
    });
    await notificationsService.notifyPaymentVerified({
      booking: finalized.booking || paidBooking,
      provider: "paypal",
      requestId
    });

    return {
      status: "paid",
      message: "Payment captured and booking confirmed in Bokun",
      booking: finalized.response
    };
  } catch (error) {
    const code = String(error?.code || "UNKNOWN_ERROR");
    if (code === "PAYPAL_REFERENCE_MISMATCH") {
      logger.warn("PayPal capture rejected because references do not match", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference
      });
      throw error;
    }
    const isPendingFinalization = code === "BOKUN_FINALIZATION_PENDING" || code === "BOKUN_REQUEST_FAILED";
    const bookingAfterError = await Booking.findById(booking._id);

    if (bookingAfterError) {
      if (isPendingFinalization) {
        bookingAfterError.bookingStatus = bookingAfterError.bokunBookingId ? bookingAfterError.bookingStatus : "pending";
        bookingAfterError.paymentStatus = "paid";
      } else if (bookingAfterError.paymentStatus !== "paid") {
        bookingAfterError.bookingStatus = "failed";
        bookingAfterError.paymentStatus = "failed";
      }

      bookingAfterError.pendingCheckout = {
        ...(bookingAfterError.pendingCheckout || {}),
        finalizationErrorAt: new Date().toISOString(),
        finalizationError: error.message,
        finalizationErrorCode: code,
        finalizationPending: isPendingFinalization
      };
      await bookingAfterError.save();
    }

    if (isPendingFinalization) {
      await notificationsService.notifyBokunPending({
        booking: bookingAfterError || booking,
        provider: "paypal",
        requestId,
        error: error.message
      });

      return {
        status: "paid_pending_finalization",
        message:
          "Payment captured. Bokun confirmation is pending due to a temporary sync issue. Please retry shortly.",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "paid",
          bookingStatus: bookingAfterError?.bokunBookingId ? bookingAfterError.bookingStatus : "pending",
          sourceChannel: bookingAfterError?.sourceChannel || booking.sourceChannel || "direct_website",
          isAgentBooking: Boolean(bookingAfterError?.agentId || booking.agentId)
        }
      };
    }

    return {
      status: "failed",
      message: error.message || "PayPal payment capture failed",
      booking: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        paymentStatus: "failed",
        bookingStatus: "failed",
        sourceChannel: booking.sourceChannel || "direct_website",
        isAgentBooking: Boolean(booking.agentId)
      }
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

const handlePaymentCancel = async ({ orderId = "", bookingId = "", requestId = "" } = {}) => {
  const booking =
    (bookingId ? await Booking.findById(bookingId) : null) ||
    (orderId ? await resolveBookingByOrderId(orderId) : null);

  if (!booking) {
    return {
      status: "cancelled",
      message: "Payment cancelled"
    };
  }

  if (booking.paymentStatus === "paid" && booking.bokunBookingId) {
    return {
      status: "paid",
      message: "Booking already paid and confirmed",
      booking: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference
      }
    };
  }

  await bookingsService.markBookingPaymentFailed({
    bookingId: booking._id,
    requestId,
    reason: "Customer cancelled PayPal payment",
    transactionToken: orderId,
    paymentMethod: "paypal"
  });

  await paymentsService.updatePaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "paypal",
    status: "failed",
    paidAmount: 0,
    orderTrackingId: orderId,
    providerResponse: {
      stage: "cancel",
      response: {
        orderId
      }
    }
  });

  return {
    status: "cancelled",
    message: "Payment cancelled",
    booking: {
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      paymentStatus: "failed",
      bookingStatus: "failed"
    }
  };
};

const resolveWebhookOrderId = (event = {}) => {
  const resource = event?.resource || {};
  return String(
    resource?.supplementary_data?.related_ids?.order_id ||
      resource?.id ||
      resource?.invoice_id ||
      ""
  ).trim();
};

const handleWebhookEvent = async ({ event = {}, headers = {}, requestId = "" } = {}) => {
  await verifyWebhookSignature({ headers, event, requestId });

  const eventType = String(event?.event_type || "").trim().toUpperCase();
  const orderId = resolveWebhookOrderId(event);

  // Subscribe to CHECKOUT.ORDER.APPROVED in the PayPal dashboard. Capturing
  // at that point keeps the existing reconciliation and Bokun retry flow intact.
  if (eventType !== "CHECKOUT.ORDER.APPROVED") {
    return {
      accepted: true,
      ignored: true,
      eventType,
      reason: "event_not_handled"
    };
  }

  if (!orderId) {
    throw new AppError("PayPal webhook is missing an order ID", 422, "PAYPAL_WEBHOOK_ORDER_ID_MISSING");
  }

  const result = await handlePaymentSuccess({ orderId, requestId: requestId || `paypal_webhook_${Date.now()}` });
  return {
    accepted: true,
    eventType,
    orderId,
    result
  };
};

module.exports = {
  createPayment,
  handlePaymentSuccess,
  handlePaymentCancel,
  handleWebhookEvent,
  refundCapturedPayment,
  getRefundDetails,
  __testables: {
    validatePaypalVerification
  }
};

const axios = require("axios");
const Booking = require("../../../models/Booking");
const logger = require("../../../config/logger");
const { env, isPesapalConfigured } = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const bookingsService = require("../../bookings/bookings.service");
const paymentsService = require("../payments.service");
const {
  normalizePesapalStatus,
  isPaidPesapalStatus,
  toMoneyAmount,
  normalizeCurrency,
  buildPesapalOrderReference,
  resolveOrderTrackingId,
  resolveMerchantReference,
  resolveRedirectUrl,
  isLocalOrPrivateRedirectUrl
} = require("./pesapal.utils");

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

  if (!env.PESAPAL_IPN_ID) {
    throw new AppError(
      "Pesapal IPN ID is required in live mode. Set PESAPAL_IPN_ID after registering your callback URL in Pesapal.",
      503,
      "PESAPAL_IPN_ID_MISSING"
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
  if (details.code === "BOKUN_FINALIZATION_PENDING") {
    return true;
  }

  if (details.code !== "BOKUN_REQUEST_FAILED") {
    return false;
  }

  return details.statusCode >= 500;
};

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
      notification_id: env.PESAPAL_IPN_ID,
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
    return {
      orderTrackingId: trackingId,
      status: "COMPLETED",
      statusDescription: "Mock payment verified",
      amount: 0,
      currency: "USD",
      isPaid: true,
      raw: {}
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
  const isPaid = isPaidPesapalStatus(status);

  return {
    orderTrackingId: trackingId,
    status,
    statusDescription,
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

  if (latestPayment?.intentId) {
    await paymentsService.updatePaymentStatus({
      intentId: latestPayment.intentId,
      status: "pending",
      providerResponse
    });
    return latestPayment;
  }

  const createdIntent = await paymentsService.createPaymentIntent({
    bookingReference: booking.bookingReference,
    customerId: booking.customer?.customerId || null,
    amount: Number(booking.amount || 0),
    currency: booking.currency || "USD",
    provider: "pesapal",
    notes: "Pesapal payment intent created"
  });

  if (createdIntent?.intentId) {
    const updated = await paymentsService.updatePaymentStatus({
      intentId: createdIntent.intentId,
      status: "pending",
      providerResponse
    });

    return updated || createdIntent;
  }

  return createdIntent;
};

const updatePaymentLogForVerification = async ({
  bookingReference,
  isPaid,
  amount,
  verification
}) =>
  paymentsService.updatePaymentByBookingReference({
    bookingReference,
    provider: "pesapal",
    status: isPaid ? "paid" : "failed",
    paidAmount: isPaid ? Number(amount || 0) : 0,
    providerResponse: {
      stage: "get_transaction_status",
      response: verification.raw || verification
    }
  });

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

  const orderResponse = await createOrderWithPesapal({
    booking,
    requestId
  });

  booking.paymentTransactionId = orderResponse.orderTrackingId;
  booking.dpoTransactionToken = orderResponse.orderTrackingId;
  booking.paymentStatus = "pending";
  booking.paymentMethod = "pesapal";
  booking.bookingStatus = booking.bokunBookingId ? booking.bookingStatus : "pending";
  booking.pendingCheckout = {
    ...(booking.pendingCheckout || {}),
    pesapalInitializedAt: new Date().toISOString(),
    pesapalOrderTrackingId: orderResponse.orderTrackingId,
    pesapalMerchantReference: orderResponse.merchantReference,
    pesapalCreateOrderResult: orderResponse.raw || {}
  };
  await booking.save();

  await updatePaymentLogForCreate({
    booking,
    orderResponse
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

const handlePaymentSuccess = async ({
  orderTrackingId = "",
  orderMerchantReference = "",
  requestId
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
      booking: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        bokunBookingId: booking.bokunBookingId,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus
      }
    };
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
          bookingStatus: latest.bookingStatus
        }
      };
    }

    throw new AppError("Payment verification is already processing", 409, "PAYMENT_PROCESSING");
  }

  try {
    const trackingId = String(orderTrackingId || booking.paymentTransactionId || "").trim();
    const verification = await verifyOrderWithPesapal({
      orderTrackingId: trackingId,
      requestId
    });

    if (!verification.isPaid) {
      await bookingsService.markBookingPaymentFailed({
        bookingId: booking._id,
        requestId,
        reason: verification.statusDescription || "Pesapal payment was not successful",
        transactionToken: trackingId,
        paymentMethod: "pesapal"
      });

      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification
      });

      return {
        status: "failed",
        message: verification.statusDescription || "Payment was not successful",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "failed",
          bookingStatus: "failed"
        }
      };
    }

    const paidAmount = Number(booking.amount || verification.amount || 0);
    const finalized = await bookingsService.finalizePendingBookingAfterPayment({
      bookingId: booking._id,
      transactionToken: trackingId,
      paymentMethod: "pesapal",
      paymentProvider: "pesapal",
      requestId,
      auditReason: "Pesapal payment verified and booking created in Bokun"
    });

    await updatePaymentLogForVerification({
      bookingReference: booking.bookingReference,
      isPaid: true,
      amount: paidAmount,
      verification
    });

    return {
      status: "paid",
      message: "Payment verified and booking confirmed in Bokun",
      booking: finalized.response
    };
  } catch (error) {
    const finalizationMeta = extractBokunFinalizationErrorMeta(error);
    const isPendingFinalization = isBokunFinalizationPendingError(error);
    const bookingAfterError = await Booking.findById(booking._id);
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

    await updatePaymentLogForVerification({
      bookingReference: booking.bookingReference,
      isPaid: isPendingFinalization,
      amount: isPendingFinalization ? Number(booking.amount || 0) : 0,
      verification: {
        status: isPendingFinalization ? "PAID_PENDING_BOKUN_FINALIZATION" : "FINALIZATION_ERROR",
        statusDescription: finalizationMeta.message,
        raw: {
          error: finalizationMeta.message,
          code: finalizationMeta.code,
          statusCode: finalizationMeta.statusCode,
          attempts: finalizationMeta.attempts
        }
      }
    });

    if (isPendingFinalization) {
      logger.warn("Payment verified but Bokun finalization is pending", {
        requestId,
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        errorCode: finalizationMeta.code,
        statusCode: finalizationMeta.statusCode
      });

      return {
        status: "paid_pending_finalization",
        message:
          "Payment verified. Bokun confirmation is pending due to a temporary sync issue. Please retry shortly.",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "paid",
          bookingStatus: bookingAfterError?.bokunBookingId ? bookingAfterError.bookingStatus : "pending"
        }
      };
    }

    return {
      status: "failed",
      message: finalizationMeta.message || "Payment verification failed before Bokun confirmation",
      booking: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        paymentStatus: "failed",
        bookingStatus: "failed"
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

  const trackingId = String(orderTrackingId || booking.paymentTransactionId || "").trim();

  await bookingsService.markBookingPaymentFailed({
    bookingId: booking._id,
    requestId,
    reason: "Customer cancelled Pesapal payment",
    transactionToken: trackingId,
    paymentMethod: "pesapal"
  });

  await paymentsService.updatePaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "pesapal",
    status: "failed",
    paidAmount: 0,
    providerResponse: {
      stage: "cancel",
      response: {
        orderTrackingId: trackingId,
        orderMerchantReference
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

module.exports = {
  createPayment,
  handlePaymentSuccess,
  handlePaymentCancel
};

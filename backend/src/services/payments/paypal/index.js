const axios = require("axios");
const Booking = require("../../../models/Booking");
const logger = require("../../../config/logger");
const { env, isPaypalConfigured } = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const bookingsService = require("../../bookings");
const paymentsService = require("..");
const notificationsService = require("../../notifications");
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
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
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
      paymentMethod: payload.paymentMethod || "paypal"
    },
    auth,
    requestId
  });

  return prepared.bookingDoc;
};

const createOrderWithPaypal = async ({ booking, requestId }) => {
  const amount = toMoneyAmount(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
  const currency = String(booking.currency || booking.pricingSnapshot?.currency || "USD").toUpperCase();

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

const captureOrderWithPaypal = async ({ orderId, bookingReference = "", requestId = "" }) => {
  const token = String(orderId || "").trim();
  if (!token) {
    throw new AppError("PayPal order ID is required", 400, "PAYPAL_ORDER_ID_REQUIRED");
  }

  if (shouldMock) {
    const mockPaid = Boolean(env.PAYPAL_MOCK_CONFIRMS_PAYMENT && env.BOKUN_MOCK_MODE);
    return {
      orderId: token,
      status: mockPaid ? "COMPLETED" : "PENDING",
      isPaid: mockPaid,
      amount: 0,
      currency: "USD",
      captureId: mockPaid ? `MOCKCAPTURE-${Date.now()}` : "",
      raw: {
        id: token,
        status: mockPaid ? "COMPLETED" : "PENDING",
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
    amount: Number(amount.value || 0),
    currency: String(amount.currency_code || "USD").toUpperCase(),
    captureId: String(capture.id || ""),
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

  if (latestPayment?.intentId) {
    await paymentsService.updatePaymentStatus({
      intentId: latestPayment.intentId,
      status: "pending",
      providerTransactionId: orderResponse.orderId,
      orderTrackingId: orderResponse.orderId,
      merchantReference: booking.bookingReference,
      rawResponse: orderResponse.raw || {},
      providerResponse
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
  verification,
  localStatus = ""
}) => {
  const status = localStatus || (isPaid ? "paid" : "failed");
  const paidAmount = isPaid ? Number(amount || 0) : 0;
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
    amount: Number(amount || verification.amount || 0),
    currency: verification.currency || "USD",
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

    const paidAmount = Number(booking.amount || verification.amount || 0);
    await updatePaymentLogForVerification({
      bookingReference: booking.bookingReference,
      isPaid: true,
      amount: paidAmount,
      verification
    });

    const paidBooking = await bookingsService.markBookingPaymentVerified({
      bookingId: booking._id,
      requestId,
      transactionToken: verification.captureId || orderId,
      paymentMethod: "paypal",
      paymentProvider: "paypal",
      amountPaid: paidAmount,
      currency: verification.currency || booking.currency || "USD",
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

module.exports = {
  createPayment,
  handlePaymentSuccess,
  handlePaymentCancel
};

const axios = require("axios");
const Booking = require("../../../models/Booking");
const logger = require("../../../config/logger");
const { env, isDpoConfigured } = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const bookingsService = require("../../bookings/bookings.service");
const paymentsService = require("../payments.service");
const {
  buildCreateTokenXml,
  buildVerifyTokenXml,
  parseCreateTokenResponse,
  parseVerifyTokenResponse,
  isSuccessfulResultCode,
  isPaidTransaction,
  buildDpoPayUrl,
  buildDpoRequestId,
  normalizeServiceType,
  isLocalOrPrivateRedirectUrl
} = require("./dpo.utils");

const dpoClient = axios.create({
  baseURL: env.DPO_BASE_URL,
  timeout: env.DPO_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/xml"
  }
});

const shouldMock = Boolean(env.DPO_MOCK_MODE);

const areLiveRedirectsLocal = () =>
  isLocalOrPrivateRedirectUrl(env.DPO_SUCCESS_URL) ||
  isLocalOrPrivateRedirectUrl(env.DPO_CANCEL_URL);

const ensureDpoConfiguration = () => {
  if (shouldMock) {
    return;
  }

  if (!isDpoConfigured) {
    throw new AppError(
      "DPO is not configured. Set DPO_COMPANY_TOKEN and DPO_SERVICE_TYPE, or enable DPO_MOCK_MODE=true.",
      503,
      "DPO_NOT_CONFIGURED"
    );
  }

  if (!env.DPO_ALLOW_LOCAL_REDIRECTS && areLiveRedirectsLocal()) {
    throw new AppError(
      "DPO live mode requires public callback URLs. Localhost/127.0.0.1 redirects are blocked. Set public DPO_SUCCESS_URL and DPO_CANCEL_URL (for example via ngrok).",
      422,
      "DPO_INVALID_REDIRECT_URLS",
      {
        DPO_SUCCESS_URL: env.DPO_SUCCESS_URL,
        DPO_CANCEL_URL: env.DPO_CANCEL_URL
      }
    );
  }
};

const postDpoXml = async (xml, requestId) => {
  const path = String(env.DPO_API_PATH || "/API/v6/");
  try {
    const { data } = await dpoClient.post(path, xml, {
      headers: {
        "x-request-id": requestId
      },
      responseType: "text"
    });

    return typeof data === "string" ? data : String(data || "");
  } catch (error) {
    const statusCode = Number(error.response?.status || 502);
    const responseText =
      typeof error.response?.data === "string"
        ? error.response.data
        : JSON.stringify(error.response?.data || {});

    const details = {
      statusCode,
      dpoPath: path,
      responsePreview: String(responseText || "").slice(0, 500),
      requestId
    };

    if (statusCode === 403) {
      const message = !env.DPO_ALLOW_LOCAL_REDIRECTS && areLiveRedirectsLocal()
        ? "DPO blocked the request because redirect URLs are local. Use public URLs for DPO_SUCCESS_URL and DPO_CANCEL_URL."
        : "DPO blocked the request (HTTP 403). Confirm DPO account activation and any gateway-side IP/security restrictions.";

      throw new AppError(message, 502, "DPO_EDGE_BLOCKED", details);
    }

    throw new AppError(
      `DPO API request failed: ${error.message || "unknown error"}`,
      502,
      "DPO_API_REQUEST_FAILED",
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
    payload,
    auth,
    requestId
  });

  return prepared.bookingDoc;
};

const createTokenWithDpo = async ({ booking, requestId }) => {
  const amount = Number(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
  const currency = String(booking.currency || booking.pricingSnapshot?.currency || "USD");
  const normalizedServiceType = normalizeServiceType(env.DPO_SERVICE_TYPE);

  if (shouldMock) {
    const transactionToken = `MOCKDPO-${buildDpoRequestId(booking.bookingReference)}`;
    return {
      resultCode: "000",
      resultExplanation: "Mock DPO token created",
      transactionToken,
      transactionRef: booking.bookingReference,
      rawXml: "<mock />"
    };
  }

  if (!normalizedServiceType) {
    throw new AppError(
      "DPO service type is missing or invalid. Set DPO_SERVICE_TYPE (example: 80721).",
      503,
      "DPO_SERVICE_TYPE_INVALID"
    );
  }

  const requestXml = buildCreateTokenXml({
    companyToken: env.DPO_COMPANY_TOKEN,
    serviceType: normalizedServiceType,
    amount,
    currency,
    bookingReference: booking.bookingReference,
    productTitle: booking.productTitle,
    customer: booking.customer || {},
    successUrl: env.DPO_SUCCESS_URL,
    cancelUrl: env.DPO_CANCEL_URL,
    callbackUrl: env.DPO_CALLBACK_URL,
    transactionRef: booking.bookingReference
  });

  const responseXml = await postDpoXml(requestXml, requestId);
  const parsed = parseCreateTokenResponse(responseXml);

  if (!isSuccessfulResultCode(parsed.resultCode) || !parsed.transactionToken) {
    const resultCode = String(parsed.resultCode || "").trim();
    const mappedStatus = resultCode === "802" ? 503 : 502;
    const mappedCode = resultCode === "802" ? "DPO_COMPANY_INACTIVE" : "DPO_CREATE_TOKEN_FAILED";

    throw new AppError(
      parsed.resultExplanation || "Failed to initialize DPO payment token",
      mappedStatus,
      mappedCode,
      {
        ...parsed,
        resultCode
      }
    );
  }

  return parsed;
};

const verifyTokenWithDpo = async ({ transactionToken, requestId }) => {
  if (!transactionToken) {
    throw new AppError("Transaction token is required", 400, "DPO_TOKEN_REQUIRED");
  }

  if (shouldMock) {
    return {
      resultCode: "000",
      resultExplanation: "Mock payment verified",
      transactionToken,
      transactionRef: "",
      transactionStatus: "PAID",
      transactionAmount: 0,
      transactionCurrency: "USD",
      transactionDate: new Date().toISOString(),
      rawXml: "<mock />"
    };
  }

  const requestXml = buildVerifyTokenXml({
    companyToken: env.DPO_COMPANY_TOKEN,
    transactionToken
  });

  const responseXml = await postDpoXml(requestXml, requestId);
  return parseVerifyTokenResponse(responseXml);
};

const updatePaymentLogForCreate = async ({ booking, tokenResponse }) => {
  const providerResponse = {
    stage: "create_token",
    response: tokenResponse
  };

  const latestPayment = await paymentsService.findLatestPaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "dpo"
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
    provider: "dpo",
    notes: "DPO payment intent created"
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
    provider: "dpo",
    status: isPaid ? "paid" : "failed",
    paidAmount: isPaid ? Number(amount || 0) : 0,
    providerResponse: {
      stage: "verify_token",
      response: verification
    }
  });

const createPayment = async ({ payload, auth, requestId }) => {
  ensureDpoConfiguration();

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

  const tokenResponse = await createTokenWithDpo({
    booking,
    requestId
  });

  booking.dpoTransactionToken = tokenResponse.transactionToken;
  booking.paymentStatus = "pending";
  booking.paymentMethod = "dpo";
  booking.bookingStatus = booking.bokunBookingId ? booking.bookingStatus : "pending";
  booking.pendingCheckout = {
    ...(booking.pendingCheckout || {}),
    dpoInitializedAt: new Date().toISOString(),
    dpoCreateTokenResult: {
      resultCode: tokenResponse.resultCode,
      resultExplanation: tokenResponse.resultExplanation
    }
  };
  await booking.save();

  await updatePaymentLogForCreate({
    booking,
    tokenResponse
  });

  const redirectUrl = shouldMock
    ? `${env.DPO_SUCCESS_URL}?TransactionToken=${encodeURIComponent(tokenResponse.transactionToken)}`
    : buildDpoPayUrl(env.DPO_BASE_URL, env.DPO_PAYMENT_PATH, tokenResponse.transactionToken);

  logger.info("DPO payment token created", {
    requestId,
    bookingReference: booking.bookingReference,
    bookingId: booking._id.toString(),
    transactionToken: tokenResponse.transactionToken
  });

  return {
    bookingId: booking._id,
    bookingReference: booking.bookingReference,
    redirectUrl,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus
  };
};

const resolveBookingByToken = async (transactionToken = "") => {
  const token = String(transactionToken || "").trim();
  if (!token) {
    return null;
  }

  return Booking.findOne({ dpoTransactionToken: token });
};

const handlePaymentSuccess = async ({ transactionToken, requestId }) => {
  ensureDpoConfiguration();

  const booking = await resolveBookingByToken(transactionToken);
  if (!booking) {
    throw new AppError("Booking not found for this transaction token", 404, "BOOKING_TOKEN_NOT_FOUND");
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
    const verification = await verifyTokenWithDpo({
      transactionToken,
      requestId
    });
    const paid = isPaidTransaction(verification);

    if (!paid) {
      await bookingsService.markBookingPaymentFailed({
        bookingId: booking._id,
        requestId,
        reason: verification.resultExplanation || "DPO payment was not successful",
        transactionToken,
        paymentMethod: "dpo"
      });

      await updatePaymentLogForVerification({
        bookingReference: booking.bookingReference,
        isPaid: false,
        amount: 0,
        verification
      });

      return {
        status: "failed",
        message: verification.resultExplanation || "Payment was not successful",
        booking: {
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          paymentStatus: "failed",
          bookingStatus: "failed"
        }
      };
    }

    const paidAmount = Number(booking.amount || verification.transactionAmount || 0);
    const finalized = await bookingsService.finalizePendingBookingAfterPayment({
      bookingId: booking._id,
      transactionToken,
      requestId,
      paymentMethod: "dpo",
      paymentProvider: "dpo",
      source: "dpo_callback",
      auditReason: "DPO payment verified and booking created in Bokun"
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
      logger.warn("DPO payment verified but Bokun finalization is pending", {
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

const handlePaymentCancel = async ({ transactionToken = "", bookingId = "", requestId }) => {
  const booking =
    (bookingId ? await Booking.findById(bookingId) : null) ||
    (transactionToken ? await resolveBookingByToken(transactionToken) : null);

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
    reason: "Customer cancelled DPO payment",
    transactionToken,
    paymentMethod: "dpo"
  });

  await paymentsService.updatePaymentByBookingReference({
    bookingReference: booking.bookingReference,
    provider: "dpo",
    status: "failed",
    paidAmount: 0,
    providerResponse: {
      stage: "cancel",
      response: {
        transactionToken
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

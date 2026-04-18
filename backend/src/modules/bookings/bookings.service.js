const dayjs = require("dayjs");
const { v4: uuidv4 } = require("uuid");
const Booking = require("../../models/Booking");
const Customer = require("../../models/Customer");
const ProductSnapshot = require("../../models/ProductSnapshot");
const AuditLog = require("../../models/AuditLog");
const CommissionRecord = require("../../models/CommissionRecord");
const logger = require("../../config/logger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { signQuoteToken, verifyQuoteToken } = require("../../utils/quoteToken");
const bokunService = require("../../integrations/bokun");
const offersService = require("../offers/offers.service");
const invoicesService = require("../invoices/invoices.service");
const commissionsService = require("../commissions/commissions.service");
const paymentsService = require("../payments/payments.service");

const normalizeTicketCategory = (value = "") => {
  const token = String(value).toLowerCase();

  if (token.includes("adult")) {
    return "adult";
  }

  if (token.includes("child")) {
    return "child";
  }

  if (token.includes("infant") || token.includes("baby")) {
    return "infant";
  }

  return "other";
};

const normalizePriceCategoryParticipants = (participants = []) =>
  (participants || [])
    .map((item) => ({
      categoryId: String(item.categoryId || item.pricingCategoryId || ""),
      title: item.title || "",
      ticketCategory: item.ticketCategory || "",
      quantity: Math.max(0, Number(item.quantity || 0))
    }))
    .filter((item) => item.categoryId);

const RETRYABLE_BOKUN_NETWORK_TOKENS = [
  "timeout",
  "timed out",
  "econnreset",
  "enotfound",
  "eai_again",
  "socket hang up",
  "network",
  "stream has been aborted",
  "service unavailable",
  "bad gateway",
  "gateway timeout"
];

const RETRYABLE_BOKUN_PAYLOAD_TOKENS = [
  "could not process this request",
  "not available",
  "no availability",
  "start time",
  "timeslot",
  "slot",
  "capacity",
  "rate",
  "catalog",
  "price category",
  "participant",
  "passenger",
  "extra"
];

const FINALIZATION_STATUS = {
  IDLE: "idle",
  PROCESSING: "processing",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  PENDING_RETRY: "pending_retry"
};

const FINALIZATION_LOCK_STALE_AFTER_SECONDS = 15 * 60;

const toIsoNow = () => new Date().toISOString();

const resolveFinalizationIdempotencyKey = (booking = {}) => {
  const existing = String(booking?.pendingCheckout?.finalization?.idempotencyKey || "").trim();
  if (existing) {
    return existing;
  }

  const token =
    String(booking.paymentTransactionId || booking.dpoTransactionToken || "").trim() ||
    String(booking.bookingReference || "").trim() ||
    String(booking._id || "").trim();

  return `bokun_finalization_${String(booking._id || "unknown")}_${token || "fallback"}`;
};

const calculateNextFinalizationRetryAt = (attemptCount = 1) => {
  const baseSeconds = Math.max(30, Number(env.BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS || 180));
  const multiplier = Math.min(Math.max(1, Number(attemptCount || 1)), 6);
  const waitSeconds = baseSeconds * multiplier;
  return new Date(Date.now() + waitSeconds * 1000).toISOString();
};

const extractFinalizationMetaFromError = (error) => {
  const summary = extractBokunErrorSummary(error);
  const attempts = Array.isArray(error?.details?.attempts) ? error.details.attempts : [];
  const statusCode = Number(summary.statusCode || 0);
  const code = summary.code || String(error?.code || "UNKNOWN_ERROR");
  const message = summary.message || String(error?.message || "Bokun booking create failed");

  const isPendingRetry =
    code === "BOKUN_FINALIZATION_PENDING" ||
    statusCode >= 500 ||
    isRetryableBokunNetworkError(summary) ||
    isRetryableBokunPayloadError(summary);

  return {
    code,
    statusCode: Number.isFinite(statusCode) ? statusCode : 0,
    message,
    attempts,
    isPendingRetry
  };
};

const acquireFinalizationLock = async ({ bookingId, idempotencyKey, requestId, source = "system", force = false }) => {
  const lockToken = uuidv4();
  const nowIso = toIsoNow();
  const staleBefore = new Date(
    Date.now() - FINALIZATION_LOCK_STALE_AFTER_SECONDS * 1000
  ).toISOString();

  const query = {
    _id: bookingId,
    $or: [
      { "pendingCheckout.finalization.lockToken": { $exists: false } },
      { "pendingCheckout.finalization.lockToken": "" },
      { "pendingCheckout.finalization.lockedAt": { $exists: false } },
      { "pendingCheckout.finalization.lockedAt": { $lte: staleBefore } }
    ]
  };

  if (force) {
    delete query.$or;
  }

  const booking = await Booking.findOneAndUpdate(
    query,
    {
      $set: {
        "pendingCheckout.finalization.idempotencyKey": idempotencyKey,
        "pendingCheckout.finalization.status": FINALIZATION_STATUS.PROCESSING,
        "pendingCheckout.finalization.lockToken": lockToken,
        "pendingCheckout.finalization.lockedAt": nowIso,
        "pendingCheckout.finalization.lastAttemptAt": nowIso,
        "pendingCheckout.finalization.lastAttemptSource": source
      },
      $inc: {
        "pendingCheckout.finalization.attemptCount": 1
      }
    },
    { new: true }
  );

  if (booking) {
    return {
      booking,
      lockToken
    };
  }

  const latest = await Booking.findById(bookingId);
  if (latest?.paymentStatus === "paid" && latest?.bokunBookingId) {
    return {
      booking: latest,
      lockToken: "",
      alreadyFinalized: true
    };
  }

  logger.warn("Booking finalization lock busy", {
    requestId,
    bookingId: String(bookingId || ""),
    source
  });

  throw new AppError(
    "Booking finalization is already processing",
    409,
    "BOOKING_FINALIZATION_IN_PROGRESS",
    {
      bookingId: String(bookingId || ""),
      source
    }
  );
};

const releaseFinalizationLock = async ({
  bookingId,
  lockToken,
  status,
  nextRetryAt = "",
  errorMeta = null
}) => {
  if (!lockToken) {
    return;
  }

  const update = {
    $set: {
      "pendingCheckout.finalization.status": status,
      "pendingCheckout.finalization.processingCompletedAt": toIsoNow()
    },
    $unset: {
      "pendingCheckout.finalization.lockToken": "",
      "pendingCheckout.finalization.lockedAt": ""
    }
  };

  if (nextRetryAt) {
    update.$set["pendingCheckout.finalization.nextRetryAt"] = nextRetryAt;
  } else {
    update.$unset["pendingCheckout.finalization.nextRetryAt"] = "";
  }

  if (errorMeta) {
    update.$set["pendingCheckout.finalization.lastError"] = {
      code: errorMeta.code || "UNKNOWN_ERROR",
      statusCode: Number(errorMeta.statusCode || 0) || null,
      message: errorMeta.message || "Bokun finalization failed",
      at: toIsoNow()
    };
    update.$set["pendingCheckout.finalization.finalizationPending"] = Boolean(errorMeta.isPendingRetry);
    if (errorMeta.attempts?.length) {
      update.$set["pendingCheckout.finalization.finalizationAttempts"] = errorMeta.attempts;
    }
  } else {
    update.$unset["pendingCheckout.finalization.lastError"] = "";
    update.$set["pendingCheckout.finalization.finalizationPending"] = false;
  }

  await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      "pendingCheckout.finalization.lockToken": lockToken
    },
    update
  );
};

const buildPendingFinalizationQuery = ({ nowIso = toIsoNow(), force = false } = {}) => {
  const query = {
    paymentStatus: "paid",
    $or: [{ bokunBookingId: { $exists: false } }, { bokunBookingId: "" }],
    "pendingCheckout.checkoutPayload": { $exists: true }
  };

  if (force) {
    return query;
  }

  query.$and = [
    {
      $or: [
        { "pendingCheckout.finalization.status": { $exists: false } },
        { "pendingCheckout.finalization.status": FINALIZATION_STATUS.PENDING_RETRY },
        { "pendingCheckout.finalization.status": FINALIZATION_STATUS.FAILED },
        { "pendingCheckout.finalization.status": FINALIZATION_STATUS.IDLE }
      ]
    },
    {
      $or: [
        { "pendingCheckout.finalization.nextRetryAt": { $exists: false } },
        { "pendingCheckout.finalization.nextRetryAt": "" },
        { "pendingCheckout.finalization.nextRetryAt": { $lte: nowIso } }
      ]
    }
  ];

  return query;
};

const normalizeErrorMessageText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeErrorMessageText(item)).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return [
      normalizeErrorMessageText(value.message),
      normalizeErrorMessageText(value.error),
      normalizeErrorMessageText(value.reason),
      normalizeErrorMessageText(value.detail),
      normalizeErrorMessageText(value.details),
      normalizeErrorMessageText(value.errors),
      normalizeErrorMessageText(value.fields)
    ]
      .filter(Boolean)
      .join(" ");
  }

  return "";
};

const extractBokunErrorSummary = (error) => {
  const statusCode = Number(error?.statusCode || error?.details?.statusCode || 0);
  const code = String(error?.code || "").trim();
  const details = error?.details || null;
  const message = [normalizeErrorMessageText(error?.message), normalizeErrorMessageText(details)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    code,
    statusCode: Number.isFinite(statusCode) ? statusCode : 0,
    message,
    details
  };
};

const isRetryableBokunNetworkError = (errorSummary = {}) => {
  if (errorSummary.statusCode >= 500) {
    return true;
  }

  const token = String(errorSummary.message || "").toLowerCase();
  return RETRYABLE_BOKUN_NETWORK_TOKENS.some((keyword) => token.includes(keyword));
};

const isRetryableBokunPayloadError = (errorSummary = {}) => {
  const status = Number(errorSummary.statusCode || 0);
  const isBokunRequestError = String(errorSummary.code || "") === "BOKUN_REQUEST_FAILED";
  if (!isBokunRequestError) {
    return false;
  }

  if (![400, 404, 409, 422].includes(status)) {
    return false;
  }

  const token = String(errorSummary.message || "").toLowerCase();
  return RETRYABLE_BOKUN_PAYLOAD_TOKENS.some((keyword) => token.includes(keyword));
};

const sanitizeParticipantsForBokunCreate = (participants = []) =>
  normalizePriceCategoryParticipants(participants)
    .map((participant) => ({
      categoryId: participant.categoryId,
      title: participant.title || "Category",
      ticketCategory: participant.ticketCategory || "",
      quantity: Math.max(0, Number(participant.quantity || 0))
    }))
    .filter((participant) => participant.categoryId && participant.quantity > 0);

const sanitizeExtrasForBokunCreate = (extras = []) =>
  (extras || [])
    .map((extra) => ({
      code: String(extra.code || ""),
      label: extra.label || "Extra",
      quantity: Math.max(0, Number(extra.quantity || 0)),
      amount: Number(extra.amount || 0)
    }))
    .filter((extra) => extra.code && extra.quantity > 0);

const buildBokunCreatePayloadVariants = ({ checkoutPayload = {}, liveQuote = {} }) => {
  const baseParticipants = sanitizeParticipantsForBokunCreate(
    liveQuote.selectedParticipants?.length
      ? liveQuote.selectedParticipants
      : checkoutPayload.priceCategoryParticipants || []
  );
  const baseExtras = sanitizeExtrasForBokunCreate(
    liveQuote.selectedExtras?.length ? liveQuote.selectedExtras : checkoutPayload.extras || []
  );

  const basePayload = {
    productId: checkoutPayload.productId,
    optionId: checkoutPayload.optionId,
    priceCatalogId: checkoutPayload.priceCatalogId || "",
    travelDate: checkoutPayload.travelDate,
    startTime: checkoutPayload.startTime || "",
    pax: checkoutPayload.pax || {},
    priceCategoryParticipants: baseParticipants,
    extras: baseExtras,
    customer: checkoutPayload.customer,
    answers: checkoutPayload.bookingQuestions || []
  };

  const variants = [];
  const signatures = new Set();

  const addVariant = (label, payload) => {
    const signature = JSON.stringify({
      startTime: String(payload.startTime || ""),
      participants: sanitizeParticipantsForBokunCreate(payload.priceCategoryParticipants || []).map((participant) => ({
        categoryId: participant.categoryId,
        quantity: participant.quantity
      })),
      extras: sanitizeExtrasForBokunCreate(payload.extras || []).map((extra) => ({
        code: extra.code,
        quantity: extra.quantity
      }))
    });

    if (signatures.has(signature)) {
      return;
    }

    signatures.add(signature);
    variants.push({ label, payload });
  };

  addVariant("primary", basePayload);

  if (basePayload.startTime) {
    addVariant("without_start_time", {
      ...basePayload,
      startTime: undefined
    });
  }

  if (baseExtras.length > 0) {
    addVariant("without_extras", {
      ...basePayload,
      extras: []
    });
  }

  if (baseParticipants.length > 0) {
    addVariant("pax_only_no_categories", {
      ...basePayload,
      priceCategoryParticipants: []
    });
  }

  if (basePayload.startTime || baseExtras.length > 0 || baseParticipants.length > 0) {
    addVariant("minimal_fallback", {
      ...basePayload,
      startTime: undefined,
      priceCategoryParticipants: [],
      extras: []
    });
  }

  return variants;
};

const createBookingInBokunWithReliability = async ({
  checkoutPayload,
  liveQuote,
  requestId,
  bookingReference = "",
  onExhaustedMessage = "Payment verified but Bokun confirmation is still processing. Please retry shortly.",
  onExhaustedCode = "BOKUN_FINALIZATION_PENDING",
  onExhaustedStatusCode = 502
}) => {
  const variants = buildBokunCreatePayloadVariants({
    checkoutPayload,
    liveQuote
  });

  const attempts = [];
  let lastError = null;

  for (let index = 0; index < variants.length; index += 1) {
    const attempt = variants[index];
    const payloadMeta = {
      hasStartTime: Boolean(attempt.payload.startTime),
      participantsCount: sanitizeParticipantsForBokunCreate(attempt.payload.priceCategoryParticipants).reduce(
        (sum, participant) => sum + Number(participant.quantity || 0),
        0
      ),
      extrasCount: sanitizeExtrasForBokunCreate(attempt.payload.extras).reduce(
        (sum, extra) => sum + Number(extra.quantity || 0),
        0
      )
    };

    try {
      const bokunBooking = await bokunService.createBooking(attempt.payload, requestId);
      attempts.push({
        attempt: index + 1,
        label: attempt.label,
        success: true,
        payloadMeta,
        attemptedAt: new Date().toISOString()
      });

      logger.info("Bokun finalization attempt succeeded", {
        requestId,
        bookingReference,
        attempt: index + 1,
        variant: attempt.label
      });

      return {
        bokunBooking,
        attempts
      };
    } catch (error) {
      const errorSummary = extractBokunErrorSummary(error);
      const hasMoreAttempts = index < variants.length - 1;
      const canRetry =
        hasMoreAttempts &&
        (isRetryableBokunNetworkError(errorSummary) || isRetryableBokunPayloadError(errorSummary));

      attempts.push({
        attempt: index + 1,
        label: attempt.label,
        success: false,
        payloadMeta,
        errorCode: errorSummary.code || "UNKNOWN_ERROR",
        statusCode: errorSummary.statusCode || null,
        message: errorSummary.message || "Bokun booking create failed",
        retryPlanned: canRetry,
        attemptedAt: new Date().toISOString()
      });

      logger.warn("Bokun finalization attempt failed", {
        requestId,
        bookingReference,
        attempt: index + 1,
        variant: attempt.label,
        statusCode: errorSummary.statusCode || null,
        code: errorSummary.code || "UNKNOWN_ERROR",
        message: errorSummary.message || error.message,
        retryPlanned: canRetry
      });

      lastError = error;
      if (!canRetry) {
        break;
      }
    }
  }

  const lastErrorSummary = extractBokunErrorSummary(lastError);
  throw new AppError(
    onExhaustedMessage,
    Number(onExhaustedStatusCode || 502),
    onExhaustedCode,
    {
      bookingReference,
      attempts,
      lastError: {
        code: lastErrorSummary.code || "UNKNOWN_ERROR",
        statusCode: lastErrorSummary.statusCode || null,
        message: lastErrorSummary.message || "Bokun booking create failed"
      }
    }
  );
};

const buildPaxSummary = (pax = {}, priceCategoryParticipants = []) => {
  const normalizedParticipants = normalizePriceCategoryParticipants(priceCategoryParticipants);

  if (normalizedParticipants.length > 0) {
    let adults = 0;
    let children = 0;
    let infants = 0;
    let others = 0;

    normalizedParticipants.forEach((participant) => {
      const category = normalizeTicketCategory(participant.ticketCategory || participant.title);

      if (category === "adult") {
        adults += participant.quantity;
        return;
      }

      if (category === "child") {
        children += participant.quantity;
        return;
      }

      if (category === "infant") {
        infants += participant.quantity;
        return;
      }

      others += participant.quantity;
    });

    return {
      adults,
      children,
      infants,
      total: adults + children + infants + others
    };
  }

  const adults = Number(pax.adults || 0);
  const children = Number(pax.children || 0);
  const infants = Number(pax.infants || 0);

  return {
    adults,
    children,
    infants,
    total: adults + children + infants
  };
};

const sanitizeSelectedExtras = (requestedExtras = [], availableExtras = []) => {
  const availableMap = new Map(
    (availableExtras || []).map((extra) => [
      String(extra.code),
      {
        code: String(extra.code),
        label: extra.label || "Extra",
        amount: Number(extra.amount || 0),
        maxQuantity: Math.max(1, Number(extra.maxQuantity || 1))
      }
    ])
  );

  return (requestedExtras || [])
    .map((item) => {
      const selected = availableMap.get(String(item.code || ""));
      if (!selected) {
        return null;
      }

      const quantity = Math.min(
        selected.maxQuantity,
        Math.max(1, Number(item.quantity || 1))
      );

      return {
        code: selected.code,
        label: selected.label,
        quantity,
        amount: selected.amount
      };
    })
    .filter(Boolean);
};

const sanitizeSelectedParticipants = (requestedParticipants = [], availableCategories = []) => {
  const requestedMap = new Map(
    normalizePriceCategoryParticipants(requestedParticipants).map((item) => [item.categoryId, item])
  );

  return (availableCategories || []).map((category) => {
    const categoryId = String(category.categoryId || "");
    const requested = requestedMap.get(categoryId);
    const minQuantity = Math.max(0, Number(category.minQuantity || 0));
    const maxQuantity = Math.max(minQuantity, Number(category.maxQuantity || 50));
    const quantity = requested ? Number(requested.quantity || 0) : Number(category.quantity || 0);

    return {
      categoryId,
      title: category.title || requested?.title || "Category",
      ticketCategory: category.ticketCategory || requested?.ticketCategory || "",
      quantity: Math.min(maxQuantity, Math.max(minQuantity, quantity))
    };
  });
};

const normalizePriceCatalogs = (priceCatalogs = []) =>
  (priceCatalogs || [])
    .map((catalog) => ({
      activityPriceCatalogId: String(catalog.activityPriceCatalogId || catalog.id || ""),
      catalogId: String(catalog.catalogId || ""),
      title: catalog.title || "Default",
      active: catalog.active !== false,
      isVendorDefault: Boolean(catalog.isVendorDefault)
    }))
    .filter((catalog) => catalog.catalogId);

const resolveSelectedPriceCatalog = (requestedCatalogId = "", availableCatalogs = []) => {
  const normalizedCatalogs = normalizePriceCatalogs(availableCatalogs).filter((catalog) => catalog.active !== false);
  if (!normalizedCatalogs.length) {
    return {
      selectedPriceCatalog: null,
      availablePriceCatalogs: []
    };
  }

  const selected =
    normalizedCatalogs.find((catalog) => catalog.catalogId === String(requestedCatalogId || "")) ||
    normalizedCatalogs.find((catalog) => catalog.isVendorDefault) ||
    normalizedCatalogs[0];

  return {
    selectedPriceCatalog: selected,
    availablePriceCatalogs: normalizedCatalogs
  };
};

const resolveSourceContext = (auth) => {
  if (!auth) {
    return {
      sourceChannel: "direct_website",
      createdByRole: "customer",
      createdByUser: { id: null, name: "Guest" },
      agentId: null
    };
  }

  if (auth.role === "agent") {
    return {
      sourceChannel: "agent_portal",
      createdByRole: "agent",
      createdByUser: { id: auth.id, name: auth.email || "Agent" },
      agentId: auth.id
    };
  }

  return {
    sourceChannel: "admin_dashboard",
    createdByRole: auth.role,
    createdByUser: { id: auth.id, name: auth.email || auth.role },
    agentId: null
  };
};

const getProductAndOption = async ({ productId, optionId, priceCatalogId }) => {
  const product = await ProductSnapshot.findOne({ bokunProductId: productId }).lean();

  if (!product) {
    throw new AppError("Product snapshot not found, run sync first", 404, "PRODUCT_SNAPSHOT_NOT_FOUND");
  }

  const option = (product.options || []).find((opt) => opt.bokunOptionId === optionId);
  if (!option) {
    throw new AppError("Option not found for selected product", 404, "OPTION_NOT_FOUND");
  }

  const { selectedPriceCatalog, availablePriceCatalogs } = resolveSelectedPriceCatalog(
    priceCatalogId,
    product.priceCatalogs || []
  );

  if (
    priceCatalogId &&
    availablePriceCatalogs.length > 0 &&
    !availablePriceCatalogs.some((catalog) => catalog.catalogId === String(priceCatalogId))
  ) {
    throw new AppError("Selected price catalog is not available for this product", 404, "PRICE_CATALOG_NOT_FOUND");
  }

  return { product, option, selectedPriceCatalog, availablePriceCatalogs };
};

const ensureSelectedTimeSlot = ({ availability, startTime }) => {
  if (!startTime) {
    return;
  }

  const selected = (availability.slots || []).find((slot) => slot.time === startTime);
  if (!selected) {
    throw new AppError("Selected start time is not available", 409, "SLOT_NOT_AVAILABLE");
  }

  if (selected.status !== "available" && selected.status !== "limited") {
    throw new AppError("Selected start time is no longer bookable", 409, "SLOT_NOT_BOOKABLE");
  }
};

const getLiveQuote = async ({
  productId,
  optionId,
  priceCatalogId,
  travelDate,
  startTime,
  pax,
  priceCategoryParticipants = [],
  extras = [],
  promoCode,
  requestId
}) => {
  const availability = await bokunService.fetchAvailability(
    { productId, optionId, travelDate, startTime, pax, priceCategoryParticipants, priceCatalogId },
    requestId
  );

  if (!availability.available) {
    throw new AppError("Selected option is not available for this date", 409, "OPTION_NOT_AVAILABLE");
  }

  ensureSelectedTimeSlot({ availability, startTime });
  const selectedParticipants = sanitizeSelectedParticipants(
    priceCategoryParticipants,
    availability.priceCategories || []
  );
  const selectedExtras = sanitizeSelectedExtras(extras, availability.extras || []);

  const extrasAmount = selectedExtras.reduce(
    (sum, item) => sum + Number(item.amount || 0) * Number(item.quantity || 0),
    0
  );

  const grossAmount = Number(availability.pricing.grossAmount || 0) + extrasAmount;

  const offerResult = await offersService.resolveApplicableOffer({
    productId,
    optionId,
    promoCode,
    baseAmount: grossAmount,
    travelDate
  });

  return {
    availability,
    selectedPriceCatalog: availability.priceCatalog || null,
    availablePriceCatalogs: availability.availablePriceCatalogs || [],
    selectedParticipants,
    pricing: {
      currency: availability.pricing.currency,
      baseAmount: availability.pricing.baseAmount,
      extraAmount: Number(availability.pricing.extraAmount || 0) + extrasAmount,
      grossAmount,
      discountAmount: offerResult.discountAmount,
      subsidyAmount: offerResult.subsidyAmount,
      finalPayable: offerResult.finalAmount,
      lineItems: [
        ...(availability.pricing.lineItems || []),
        ...selectedExtras.map((item) => ({
          label: item.label,
          quantity: item.quantity,
          unitPrice: item.amount,
          total: Number(item.amount || 0) * Number(item.quantity || 0)
        }))
      ],
      offer: offerResult.offer
    }
    ,
    selectedExtras,
    availableExtras: availability.extras || []
  };
};

const quoteBooking = async ({ payload, auth, requestId }) => {
  const { product, option, selectedPriceCatalog, availablePriceCatalogs } = await getProductAndOption(payload);
  const effectivePriceCatalogId = selectedPriceCatalog?.catalogId || String(payload.priceCatalogId || "");
  const liveQuote = await getLiveQuote({ ...payload, priceCatalogId: effectivePriceCatalogId, requestId });
  const paxSummary = buildPaxSummary(payload.pax, liveQuote.selectedParticipants);

  const quoteSign = signQuoteToken({
    productId: payload.productId,
    optionId: payload.optionId,
    priceCatalogId: effectivePriceCatalogId,
    travelDate: payload.travelDate,
    startTime: payload.startTime || "",
    pax: paxSummary,
    priceCategoryParticipants: liveQuote.selectedParticipants || [],
    extras: liveQuote.selectedExtras || [],
    promoCode: payload.promoCode || "",
    grossAmount: liveQuote.pricing.grossAmount,
    currency: liveQuote.pricing.currency,
    source: resolveSourceContext(auth).sourceChannel,
    issuedAt: new Date().toISOString()
  });

  return {
    quoteToken: quoteSign.token,
    quoteExpiresAt: quoteSign.expiresAt,
    product: {
      bokunProductId: product.bokunProductId,
      title: product.title
    },
    option: {
      bokunOptionId: option.bokunOptionId,
      name: option.name
    },
    priceCatalog: liveQuote.selectedPriceCatalog || selectedPriceCatalog || null,
    availablePriceCatalogs: liveQuote.availablePriceCatalogs || availablePriceCatalogs || [],
    priceCatalogId: effectivePriceCatalogId || null,
    paxSummary,
    travelDate: payload.travelDate,
    startTime: payload.startTime || null,
    priceCategories: liveQuote.availability.priceCategories || [],
    priceCategoryParticipants: liveQuote.selectedParticipants || [],
    extras: liveQuote.selectedExtras || [],
    availableExtras: liveQuote.availableExtras || [],
    pricing: liveQuote.pricing,
    availability: {
      slots: liveQuote.availability.slots,
      available: liveQuote.availability.available
    }
  };
};

const upsertCustomer = async (customerPayload) => {
  const normalizedEmail = customerPayload.email.toLowerCase();
  const existing = await Customer.findOne({ email: normalizedEmail });

  if (existing) {
    existing.firstName = customerPayload.firstName;
    existing.lastName = customerPayload.lastName;
    existing.country = customerPayload.country || existing.country;
    existing.phone = customerPayload.phone || existing.phone;
    existing.hotelName = customerPayload.hotelName || existing.hotelName;
    existing.notes = customerPayload.notes || existing.notes;
    await existing.save();
    return existing;
  }

  return Customer.create({
    firstName: customerPayload.firstName,
    lastName: customerPayload.lastName,
    email: normalizedEmail,
    phone: customerPayload.phone,
    country: customerPayload.country || "",
    hotelName: customerPayload.hotelName || "",
    notes: customerPayload.notes || ""
  });
};

const ensureQuoteMatchesPayload = (quotePayload, requestPayload) => {
  const requiredSame = ["productId", "optionId", "travelDate"];

  for (const key of requiredSame) {
    if (quotePayload[key] !== requestPayload[key]) {
      throw new AppError("Quote mismatch detected. Please refresh quote.", 409, "QUOTE_MISMATCH");
    }
  }

  if ((quotePayload.startTime || "") !== (requestPayload.startTime || "")) {
    throw new AppError("Quote start time mismatch. Please refresh quote.", 409, "QUOTE_MISMATCH");
  }

  if (String(quotePayload.priceCatalogId || "") !== String(requestPayload.priceCatalogId || "")) {
    throw new AppError("Price catalog changed. Please refresh quote.", 409, "QUOTE_MISMATCH");
  }

  const quoteParticipants = normalizePriceCategoryParticipants(quotePayload.priceCategoryParticipants || [])
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
  const requestParticipants = normalizePriceCategoryParticipants(requestPayload.priceCategoryParticipants || [])
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId));

  if (quoteParticipants.length || requestParticipants.length) {
    if (quoteParticipants.length !== requestParticipants.length) {
      throw new AppError("Passenger categories changed. Please refresh quote.", 409, "QUOTE_MISMATCH");
    }

    for (let index = 0; index < quoteParticipants.length; index += 1) {
      if (
        quoteParticipants[index].categoryId !== requestParticipants[index].categoryId ||
        Number(quoteParticipants[index].quantity || 0) !== Number(requestParticipants[index].quantity || 0)
      ) {
        throw new AppError("Passenger categories changed. Please refresh quote.", 409, "QUOTE_MISMATCH");
      }
    }

    return;
  }

  const quotePax = quotePayload.pax || {};
  const requestPax = buildPaxSummary(requestPayload.pax);

  if (
    Number(quotePax.adults || 0) !== requestPax.adults ||
    Number(quotePax.children || 0) !== requestPax.children ||
    Number(quotePax.infants || 0) !== requestPax.infants
  ) {
    throw new AppError("Passenger counts changed. Please refresh quote.", 409, "QUOTE_MISMATCH");
  }
};

const mapBookingQuestionsSnapshot = (bookingQuestions = []) =>
  (bookingQuestions || []).map((question) => ({
    questionId: question.questionId,
    label: question.label,
    scope: question.scope || "booking",
    passengerIndex:
      question.passengerIndex !== undefined && question.passengerIndex !== null
        ? Number(question.passengerIndex)
        : null,
    answer: question.answer
  }));

const mapPriceCatalogSnapshot = ({ selectedPriceCatalog = null, liveQuote = null } = {}) =>
  selectedPriceCatalog
    ? {
        activityPriceCatalogId: selectedPriceCatalog.activityPriceCatalogId || "",
        catalogId: selectedPriceCatalog.catalogId || "",
        title: selectedPriceCatalog.title || "Default"
      }
    : {
        activityPriceCatalogId: liveQuote?.selectedPriceCatalog?.activityPriceCatalogId || "",
        catalogId: liveQuote?.selectedPriceCatalog?.catalogId || "",
        title: liveQuote?.selectedPriceCatalog?.title || "Default"
      };

const buildBookingReference = () => {
  const timestamp = Date.now();
  const nonce = Math.floor(Math.random() * 8999) + 1000;
  return `ZNZ-${timestamp}-${nonce}`;
};

const buildValidatedCreateContext = async ({ payload, auth, requestId }) => {
  const quoteCheck = verifyQuoteToken(payload.quoteToken);
  if (!quoteCheck.valid) {
    throw new AppError("Quote expired or invalid. Please refresh quote.", 409, quoteCheck.reason || "QUOTE_INVALID");
  }

  const payloadWithCatalog = {
    ...payload,
    priceCatalogId: payload.priceCatalogId || quoteCheck.payload.priceCatalogId || ""
  };

  ensureQuoteMatchesPayload(quoteCheck.payload, payloadWithCatalog);

  const { product, option, selectedPriceCatalog } = await getProductAndOption(payloadWithCatalog);
  const sourceContext = resolveSourceContext(auth);
  const effectivePriceCatalogId =
    selectedPriceCatalog?.catalogId || String(payloadWithCatalog.priceCatalogId || "");

  const liveQuote = await getLiveQuote({
    ...payloadWithCatalog,
    priceCatalogId: effectivePriceCatalogId,
    promoCode: payloadWithCatalog.promoCode || quoteCheck.payload.promoCode || "",
    requestId
  });

  const quotedGross = Number(quoteCheck.payload.grossAmount || 0);
  const latestGross = Number(liveQuote.pricing.grossAmount || 0);

  if (Math.abs(quotedGross - latestGross) > 0.009) {
    throw new AppError(
      "Pricing changed since quote generation. Please review and confirm again.",
      409,
      "QUOTE_STALE"
    );
  }

  return {
    quoteCheck,
    payloadWithCatalog: {
      ...payloadWithCatalog,
      priceCatalogId: effectivePriceCatalogId
    },
    product,
    option,
    selectedPriceCatalog,
    sourceContext,
    liveQuote
  };
};

const syncInvoiceForBooking = async ({ bookingDoc, productSnapshot }) => {
  const invoiceSnapshot = await invoicesService.buildInvoiceSnapshot({
    booking: bookingDoc.toObject(),
    productSnapshot
  });

  bookingDoc.invoiceSnapshot = invoiceSnapshot;
  await bookingDoc.save();
  const invoiceRecord = await invoicesService.upsertInvoiceFromSnapshot(invoiceSnapshot);
  return { invoiceSnapshot, invoiceRecord };
};

const ensureCommissionForBooking = async ({
  bookingDoc,
  sourceContext,
  manualOverridePercent = null,
  notes = ""
}) => {
  if (!sourceContext?.agentId) {
    return null;
  }

  const existingCommission = await CommissionRecord.findOne({
    bookingReference: bookingDoc.bookingReference
  }).lean();
  if (existingCommission) {
    return existingCommission;
  }

  const commissionRecord = await commissionsService.createCommissionForBooking({
    booking: bookingDoc,
    agentId: sourceContext.agentId,
    manualOverridePercent,
    notes
  });

  return commissionRecord ? commissionRecord.toObject?.() || commissionRecord : null;
};

const toBookingResponsePayload = ({
  bookingDoc,
  invoiceRecord = null,
  paymentIntent = null,
  commission = null
}) => ({
  bookingReference: bookingDoc.bookingReference,
  bookingId: bookingDoc._id,
  bokunBookingId: bookingDoc.bokunBookingId,
  confirmationCode: bookingDoc.bokunConfirmationCode,
  bookingStatus: bookingDoc.bookingStatus,
  paymentStatus: bookingDoc.paymentStatus,
  priceCatalog: bookingDoc.priceCatalog || null,
  pricing: bookingDoc.pricingSnapshot,
  invoice: {
    invoiceNumber: invoiceRecord?.invoiceNumber || bookingDoc.invoiceSnapshot?.invoiceNumber || "",
    total: Number(invoiceRecord?.total ?? bookingDoc.invoiceSnapshot?.total ?? 0),
    balanceDue: Number(invoiceRecord?.balanceDue ?? bookingDoc.invoiceSnapshot?.balanceDue ?? 0)
  },
  paymentIntent: paymentIntent
    ? {
        intentId: paymentIntent.intentId,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency
      }
    : null,
  commission: commission
    ? {
        commissionAmount: commission.commissionAmount,
        commissionPercent: commission.commissionPercent,
        payoutStatus: commission.payoutStatus
      }
    : null
});

const persistBookingRecord = async ({
  context,
  bokunBooking = null,
  existingBooking = null,
  paymentStatus = "pending",
  paymentMethod = "pending",
  bookingStatus = "pending",
  paymentTransactionId = null,
  dpoTransactionToken = undefined,
  pendingCheckout,
  requestId,
  auditAction = "booking_created",
  auditReason = "Customer confirmed booking",
  createPaymentIntent = true,
  paymentProvider = "custom",
  paymentNotes = "",
  markAmountPaid = false,
  createCommission = true
}) => {
  const { payloadWithCatalog, product, option, selectedPriceCatalog, sourceContext, liveQuote } = context;
  const customer = await upsertCustomer(payloadWithCatalog.customer);

  const bookingReference =
    existingBooking?.bookingReference ||
    bokunBooking?.bookingReference ||
    buildBookingReference();
  const payableAmount = Number(liveQuote.pricing.finalPayable || liveQuote.pricing.grossAmount || 0);
  const pricingSnapshot = {
    ...liveQuote.pricing,
    amountPaid: markAmountPaid ? payableAmount : 0
  };
  const paxSummary = buildPaxSummary(payloadWithCatalog.pax, liveQuote.selectedParticipants);
  const bookingQuestionsSnapshot = mapBookingQuestionsSnapshot(payloadWithCatalog.bookingQuestions || []);

  const bookingPatch = {
    bookingReference,
    bokunBookingId: String(
      bokunBooking?.bokunBookingId || bokunBooking?.id || existingBooking?.bokunBookingId || ""
    ),
    bokunConfirmationCode:
      bokunBooking?.confirmationCode ||
      existingBooking?.bokunConfirmationCode ||
      bookingReference,
    bokunProductId: payloadWithCatalog.productId,
    bokunOptionId: payloadWithCatalog.optionId,
    productTitle: product.title,
    optionTitle: option.name,
    travelDate: payloadWithCatalog.travelDate,
    startTime: payloadWithCatalog.startTime || "",
    priceCatalog: mapPriceCatalogSnapshot({ selectedPriceCatalog, liveQuote }),
    paxSummary,
    priceCategoryParticipants: liveQuote.selectedParticipants || [],
    extras: liveQuote.selectedExtras || [],
    pricingSnapshot,
    bookingQuestionsSnapshot,
    customer: {
      customerId: customer._id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      country: customer.country,
      hotelName: customer.hotelName
    },
    paymentStatus,
    paymentMethod,
    bookingStatus,
    amount: payableAmount,
    currency: liveQuote.pricing.currency || "USD",
    sourceChannel: sourceContext.sourceChannel,
    createdByRole: sourceContext.createdByRole,
    createdByUser: sourceContext.createdByUser,
    agentId: sourceContext.agentId,
    rawBokunResponse: bokunBooking?.raw || existingBooking?.rawBokunResponse || null
  };

  const resolvedTransactionId =
    paymentTransactionId !== undefined && paymentTransactionId !== null
      ? String(paymentTransactionId || "").trim()
      : String(dpoTransactionToken || "").trim();

  if (paymentTransactionId !== undefined || dpoTransactionToken !== undefined) {
    bookingPatch.paymentTransactionId = resolvedTransactionId || null;
    // Backward compatibility for older records and callbacks.
    bookingPatch.dpoTransactionToken = resolvedTransactionId || null;
  }

  if (pendingCheckout !== undefined) {
    bookingPatch.pendingCheckout = pendingCheckout;
  }

  let bookingDoc = existingBooking || null;
  if (bookingDoc) {
    Object.assign(bookingDoc, bookingPatch);
    await bookingDoc.save();
  } else {
    bookingDoc = await Booking.create(bookingPatch);
  }

  const alreadyLinked = (customer.bookings || []).some((id) => id.toString() === bookingDoc._id.toString());
  if (!alreadyLinked) {
    customer.bookings.push(bookingDoc._id);
    await customer.save();
  }

  const { invoiceRecord } = await syncInvoiceForBooking({
    bookingDoc,
    productSnapshot: product
  });

  let paymentIntent = null;
  if (createPaymentIntent) {
    paymentIntent = await paymentsService.createPaymentIntent({
      bookingReference,
      customerId: customer._id,
      amount: payableAmount,
      currency: liveQuote.pricing.currency || "USD",
      provider: paymentProvider,
      notes: paymentNotes || "Payment intent created for booking checkout"
    });
  }

  let commission = null;
  if (createCommission) {
    commission = await ensureCommissionForBooking({
      bookingDoc,
      sourceContext,
      manualOverridePercent: payloadWithCatalog.commissionManualPercent || null,
      notes: "Auto-generated on booking finalize"
    });
  }

  await AuditLog.create({
    actorId: sourceContext.createdByUser.id,
    actorRole: sourceContext.createdByRole,
    action: auditAction,
    entityType: "Booking",
    entityId: bookingDoc._id.toString(),
    reason: auditReason,
    requestId,
    after: {
      bookingReference: bookingDoc.bookingReference,
      bookingStatus: bookingDoc.bookingStatus,
      paymentStatus: bookingDoc.paymentStatus
    },
    metadata: {
      sourceChannel: sourceContext.sourceChannel
    }
  });

  return {
    bookingDoc,
    invoiceRecord,
    paymentIntent,
    commission,
    customer,
    response: toBookingResponsePayload({
      bookingDoc,
      invoiceRecord,
      paymentIntent,
      commission
    })
  };
};

const preparePendingPaymentBooking = async ({ payload, auth, requestId }) => {
  const context = await buildValidatedCreateContext({ payload, auth, requestId });
  const expectedAmount = Number(
    context.liveQuote.pricing.finalPayable || context.liveQuote.pricing.grossAmount || 0
  );
  const requestedAmount =
    payload.amount !== undefined && payload.amount !== null
      ? Number(payload.amount)
      : expectedAmount;
  const expectedCurrency = String(context.liveQuote.pricing.currency || "USD");
  const requestedCurrency = String(payload.currency || expectedCurrency);

  if (Math.abs(requestedAmount - expectedAmount) > 0.009) {
    throw new AppError("Payment amount mismatch against live quote", 409, "PAYMENT_AMOUNT_MISMATCH");
  }

  if (requestedCurrency !== expectedCurrency) {
    throw new AppError("Payment currency mismatch against live quote", 409, "PAYMENT_CURRENCY_MISMATCH");
  }

  const pendingCheckout = {
    quoteToken: payload.quoteToken,
    preparedAt: new Date().toISOString(),
    finalization: {
      status: FINALIZATION_STATUS.IDLE,
      attemptCount: 0,
      finalizationPending: false
    },
    checkoutPayload: {
      productId: context.payloadWithCatalog.productId,
      optionId: context.payloadWithCatalog.optionId,
      priceCatalogId: context.payloadWithCatalog.priceCatalogId || "",
      travelDate: context.payloadWithCatalog.travelDate,
      startTime: context.payloadWithCatalog.startTime || "",
      pax: context.payloadWithCatalog.pax,
      priceCategoryParticipants: context.liveQuote.selectedParticipants || [],
      extras: context.liveQuote.selectedExtras || [],
      promoCode: context.payloadWithCatalog.promoCode || "",
      customer: context.payloadWithCatalog.customer,
      bookingQuestions: context.payloadWithCatalog.bookingQuestions || [],
      paymentMethod: context.payloadWithCatalog.paymentMethod || "pesapal"
    }
  };

  return persistBookingRecord({
    context,
    paymentStatus: "pending",
    paymentMethod: context.payloadWithCatalog.paymentMethod || "pesapal",
    bookingStatus: "pending",
    paymentTransactionId: null,
    pendingCheckout,
    requestId,
    auditAction: "booking_pending_payment_created",
    auditReason: "Checkout created before payment provider confirmation",
    createPaymentIntent: true,
    paymentProvider: "pesapal",
    paymentNotes: "Payment initialized before provider redirect",
    markAmountPaid: false,
    createCommission: false
  });
};

const finalizePendingBookingAfterPayment = async ({
  bookingId,
  transactionToken = "",
  paymentMethod = "pesapal",
  paymentProvider = "pesapal",
  requestId,
  source = "payment_callback",
  force = false,
  auditReason = "Payment verified and booking created in Bokun"
}) => {
  const initialBooking = await Booking.findById(bookingId);
  if (!initialBooking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (initialBooking.paymentStatus === "paid" && initialBooking.bokunBookingId) {
    return {
      booking: initialBooking,
      response: toBookingResponsePayload({ bookingDoc: initialBooking })
    };
  }

  const checkoutPayload = initialBooking.pendingCheckout?.checkoutPayload || null;
  if (!checkoutPayload) {
    throw new AppError("Pending checkout payload is missing", 409, "PENDING_CHECKOUT_NOT_FOUND");
  }

  const idempotencyKey = resolveFinalizationIdempotencyKey(initialBooking);
  const lockResult = await acquireFinalizationLock({
    bookingId: initialBooking._id,
    idempotencyKey,
    requestId,
    source,
    force
  });

  if (lockResult.alreadyFinalized) {
    return {
      booking: lockResult.booking,
      response: toBookingResponsePayload({ bookingDoc: lockResult.booking })
    };
  }

  const booking = lockResult.booking;
  const lockToken = lockResult.lockToken;

  try {
    const { product, option, selectedPriceCatalog } = await getProductAndOption({
      productId: checkoutPayload.productId,
      optionId: checkoutPayload.optionId,
      priceCatalogId: checkoutPayload.priceCatalogId || ""
    });

    const liveQuote = await getLiveQuote({
      productId: checkoutPayload.productId,
      optionId: checkoutPayload.optionId,
      priceCatalogId: checkoutPayload.priceCatalogId || "",
      travelDate: checkoutPayload.travelDate,
      startTime: checkoutPayload.startTime || "",
      pax: checkoutPayload.pax,
      priceCategoryParticipants: checkoutPayload.priceCategoryParticipants || [],
      extras: checkoutPayload.extras || [],
      promoCode: checkoutPayload.promoCode || "",
      requestId
    });

    const bokunCreateResult = await createBookingInBokunWithReliability({
      checkoutPayload,
      liveQuote,
      requestId,
      bookingReference: booking.bookingReference
    });
    const bokunBooking = bokunCreateResult.bokunBooking;

    const sourceContext = {
      sourceChannel: booking.sourceChannel || "direct_website",
      createdByRole: booking.createdByRole || "customer",
      createdByUser: booking.createdByUser || { id: null, name: "Guest" },
      agentId: booking.agentId || null
    };

    const context = {
      payloadWithCatalog: {
        ...checkoutPayload,
        bookingQuestions: checkoutPayload.bookingQuestions || [],
        commissionManualPercent: booking.pendingCheckout?.commissionManualPercent || null
      },
      product,
      option,
      selectedPriceCatalog,
      sourceContext,
      liveQuote
    };

    const finalizationState = {
      ...(booking.pendingCheckout?.finalization || {}),
      idempotencyKey,
      status: FINALIZATION_STATUS.CONFIRMED,
      finalizationPending: false,
      processingCompletedAt: toIsoNow(),
      finalizationAttempts: bokunCreateResult.attempts || [],
      nextRetryAt: ""
    };

    delete finalizationState.lockToken;
    delete finalizationState.lockedAt;
    delete finalizationState.lastError;

    const pendingCheckout = {
      ...(booking.pendingCheckout || {}),
      finalizedAt: toIsoNow(),
      transactionToken: String(transactionToken || booking.paymentTransactionId || booking.dpoTransactionToken || ""),
      finalizationStatus: "confirmed_in_bokun",
      finalizationAttempts: bokunCreateResult.attempts || [],
      finalization: finalizationState
    };

    const finalized = await persistBookingRecord({
      context,
      bokunBooking,
      existingBooking: booking,
      paymentStatus: "paid",
      paymentMethod: paymentMethod || booking.paymentMethod || "pesapal",
      bookingStatus: bokunBooking.status === "CONFIRMED" ? "confirmed" : "pending",
      paymentTransactionId: String(transactionToken || booking.paymentTransactionId || booking.dpoTransactionToken || ""),
      pendingCheckout,
      requestId,
      auditAction: "booking_paid_and_confirmed",
      auditReason,
      createPaymentIntent: false,
      markAmountPaid: true,
      createCommission: true,
      paymentProvider
    });

    return {
      booking: finalized.bookingDoc,
      response: finalized.response
    };
  } catch (error) {
    const errorMeta = extractFinalizationMetaFromError(error);
    const attemptCount = Number(booking.pendingCheckout?.finalization?.attemptCount || 1);
    const maxRetries = Math.max(1, Number(env.BOOKING_FINALIZATION_MAX_RETRIES || 8));
    const allowRetry = errorMeta.isPendingRetry && attemptCount < maxRetries;
    const status = allowRetry ? FINALIZATION_STATUS.PENDING_RETRY : FINALIZATION_STATUS.FAILED;
    const nextRetryAt = allowRetry ? calculateNextFinalizationRetryAt(attemptCount) : "";

    await releaseFinalizationLock({
      bookingId: booking._id,
      lockToken,
      status,
      nextRetryAt,
      errorMeta
    });

    if (allowRetry && errorMeta.code !== "BOKUN_FINALIZATION_PENDING") {
      throw new AppError(
        "Payment verified but Bokun confirmation is still processing. Please retry shortly.",
        502,
        "BOKUN_FINALIZATION_PENDING",
        {
          bookingReference: booking.bookingReference,
          attempts: errorMeta.attempts || [],
          lastError: {
            code: errorMeta.code,
            statusCode: errorMeta.statusCode || null,
            message: errorMeta.message
          },
          nextRetryAt
        }
      );
    }

    if (!allowRetry && errorMeta.code === "BOKUN_FINALIZATION_PENDING") {
      throw new AppError(
        "Bokun finalization retries are exhausted for this booking. Review payload and retry from admin recovery tools.",
        502,
        "BOKUN_FINALIZATION_RETRIES_EXHAUSTED",
        {
          bookingReference: booking.bookingReference,
          attempts: errorMeta.attempts || [],
          lastError: {
            code: errorMeta.code,
            statusCode: errorMeta.statusCode || null,
            message: errorMeta.message
          }
        }
      );
    }

    throw error;
  }
};

const markBookingPaymentFailed = async ({
  bookingId,
  requestId,
  reason = "Payment was not completed",
  transactionToken = "",
  paymentMethod = "pesapal"
}) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  booking.paymentStatus = "failed";
  booking.bookingStatus = booking.bokunBookingId ? booking.bookingStatus : "failed";
  booking.paymentMethod = paymentMethod || booking.paymentMethod || "pending";
  if (transactionToken) {
    booking.dpoTransactionToken = transactionToken;
    booking.paymentTransactionId = transactionToken;
  }
  booking.pendingCheckout = {
    ...(booking.pendingCheckout || {}),
    failedAt: new Date().toISOString(),
    failureReason: reason
  };
  await booking.save();

  await syncInvoiceForBooking({
    bookingDoc: booking,
    productSnapshot: await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean()
  });

  await AuditLog.create({
    actorId: null,
    actorRole: "system",
    action: "booking_payment_failed",
    entityType: "Booking",
    entityId: booking._id.toString(),
    reason,
    requestId,
    after: {
      bookingReference: booking.bookingReference,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus
    },
    metadata: {
      sourceChannel: booking.sourceChannel || "direct_website"
    }
  });

  return booking;
};

const createBooking = async ({ payload, auth, requestId }) => {
  const context = await buildValidatedCreateContext({ payload, auth, requestId });
  const bokunCreateResult = await createBookingInBokunWithReliability({
    checkoutPayload: {
      productId: context.payloadWithCatalog.productId,
      optionId: context.payloadWithCatalog.optionId,
      priceCatalogId: context.payloadWithCatalog.priceCatalogId || "",
      travelDate: context.payloadWithCatalog.travelDate,
      startTime: context.payloadWithCatalog.startTime || "",
      pax: context.payloadWithCatalog.pax,
      priceCategoryParticipants: context.liveQuote.selectedParticipants || [],
      extras: context.liveQuote.selectedExtras || [],
      customer: context.payloadWithCatalog.customer,
      bookingQuestions: context.payloadWithCatalog.bookingQuestions || []
    },
    liveQuote: context.liveQuote,
    requestId,
    onExhaustedMessage:
      "Unable to create booking in Bokun after retrying multiple payload variants.",
    onExhaustedCode: "BOKUN_BOOKING_CREATE_FAILED",
    onExhaustedStatusCode: 502
  });
  const bokunBooking = bokunCreateResult.bokunBooking;

  const persisted = await persistBookingRecord({
    context,
    bokunBooking,
    paymentStatus: "pending",
    paymentMethod: context.payloadWithCatalog.paymentMethod || "pending",
    bookingStatus: bokunBooking.status === "CONFIRMED" ? "confirmed" : "pending",
    requestId,
    auditAction: "booking_created",
    auditReason: "Customer confirmed booking",
    createPaymentIntent: true,
    paymentProvider: "custom",
    paymentNotes: "Payment intent created for booking checkout",
    markAmountPaid: false,
    createCommission: true
  });

  return persisted.response;
};

const getBookingByReference = async (reference) => {
  const booking = await Booking.findOne({ bookingReference: reference }).lean();

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  return booking;
};

const listRecentBookings = async (auth) => {
  const query = {};

  if (auth?.role === "agent") {
    query.agentId = auth.id;
  }

  return Booking.find(query)
    .select("bookingReference productTitle optionTitle travelDate startTime bookingStatus paymentStatus pricingSnapshot sourceChannel createdAt")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

const cancelBooking = async ({ id, reason, auth, requestId }) => {
  const booking = await Booking.findById(id);

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.bookingStatus === "cancelled") {
    throw new AppError("Booking already cancelled", 409, "BOOKING_ALREADY_CANCELLED");
  }

  if (booking.bokunBookingId) {
    await bokunService.cancelBooking(booking.bokunBookingId, { reason }, requestId);
  }

  const before = {
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus
  };

  booking.bookingStatus = "cancelled";
  booking.cancellation = {
    reason,
    cancelledAt: new Date(),
    cancelledBy: auth?.role || "customer"
  };
  await booking.save();

  await AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "customer",
    action: "booking_cancelled",
    entityType: "Booking",
    entityId: booking._id.toString(),
    reason,
    requestId,
    before,
    after: {
      bookingStatus: booking.bookingStatus,
      cancellation: booking.cancellation
    }
  });

  return booking.toObject();
};

const requestBookingEdit = async ({ id, payload, reason, auth, requestId }) => {
  const booking = await Booking.findById(id);

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  const editRequest = {
    requestedAt: new Date(),
    requestedBy: auth?.role || "customer",
    reason,
    payload,
    status: "pending"
  };

  booking.editRequests.push(editRequest);
  booking.bookingStatus = booking.bookingStatus === "cancelled" ? "cancelled" : "edit_requested";
  await booking.save();

  await bokunService.editBooking(booking.bokunBookingId, { reason, payload }, requestId);

  await AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "customer",
    action: "booking_edit_requested",
    entityType: "Booking",
    entityId: booking._id.toString(),
    reason,
    requestId,
    metadata: {
      payload
    }
  });

  return booking.toObject();
};

const bookingStats = async () => {
  const today = dayjs().startOf("day").toDate();
  const monthStart = dayjs().startOf("month").toDate();

  const [totalBookings, todaysBookings, monthlySales, statusBreakdown] = await Promise.all([
    Booking.countDocuments({}),
    Booking.countDocuments({ createdAt: { $gte: today } }),
    Booking.aggregate([
      { $match: { createdAt: { $gte: monthStart } } },
      { $group: { _id: null, sales: { $sum: "$pricingSnapshot.finalPayable" } } }
    ]),
    Booking.aggregate([
      {
        $group: {
          _id: "$bookingStatus",
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    totalBookings,
    todaysBookings,
    monthlySales: Number(monthlySales[0]?.sales || 0),
    statusBreakdown
  };
};

const listPendingFinalizations = async ({ limit = 20, includeProcessing = true, force = false } = {}) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const query = includeProcessing
    ? {
        paymentStatus: "paid",
        $or: [{ bokunBookingId: { $exists: false } }, { bokunBookingId: "" }],
        "pendingCheckout.checkoutPayload": { $exists: true }
      }
    : buildPendingFinalizationQuery({
        force,
        nowIso: toIsoNow()
      });

  const bookings = await Booking.find(query)
    .select(
      "bookingReference productTitle optionTitle travelDate startTime paymentStatus bookingStatus amount currency paymentTransactionId dpoTransactionToken bokunBookingId pendingCheckout.finalization pendingCheckout.checkoutPayload"
    )
    .sort({
      "pendingCheckout.finalization.nextRetryAt": 1,
      updatedAt: 1
    })
    .limit(safeLimit)
    .lean();

  return bookings.map((booking) => ({
    bookingId: booking._id,
    bookingReference: booking.bookingReference,
    productTitle: booking.productTitle,
    optionTitle: booking.optionTitle,
    travelDate: booking.travelDate,
    startTime: booking.startTime || "",
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus,
    amount: Number(booking.amount || 0),
    currency: booking.currency || "USD",
    hasPendingCheckout: Boolean(booking.pendingCheckout?.checkoutPayload),
    hasPaymentToken: Boolean(booking.paymentTransactionId || booking.dpoTransactionToken),
    finalization: {
      status: booking.pendingCheckout?.finalization?.status || FINALIZATION_STATUS.IDLE,
      attemptCount: Number(booking.pendingCheckout?.finalization?.attemptCount || 0),
      nextRetryAt: booking.pendingCheckout?.finalization?.nextRetryAt || "",
      lastError: booking.pendingCheckout?.finalization?.lastError || null,
      finalizationPending: Boolean(booking.pendingCheckout?.finalization?.finalizationPending)
    }
  }));
};

const retryBookingFinalization = async ({ bookingId, auth, requestId, force = false } = {}) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.bokunBookingId) {
    return {
      status: "already_confirmed",
      booking: toBookingResponsePayload({ bookingDoc: booking })
    };
  }

  if (booking.paymentStatus !== "paid") {
    throw new AppError(
      "Only paid bookings can be finalized in Bokun",
      409,
      "BOOKING_NOT_PAID_FOR_FINALIZATION"
    );
  }

  const finalized = await finalizePendingBookingAfterPayment({
    bookingId: booking._id,
    transactionToken: String(booking.paymentTransactionId || booking.dpoTransactionToken || ""),
    paymentMethod: booking.paymentMethod || "pending",
    paymentProvider: booking.paymentMethod === "dpo" ? "dpo" : "pesapal",
    requestId,
    source: "admin_manual_retry",
    force,
    auditReason: "Admin manually retried Bokun booking finalization"
  });

  await AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "staff",
    action: "booking_finalization_retry_triggered",
    entityType: "Booking",
    entityId: booking._id.toString(),
    reason: "Manual admin retry for Bokun finalization",
    requestId,
    metadata: {
      force: Boolean(force),
      bookingReference: booking.bookingReference
    }
  });

  return {
    status: "confirmed",
    booking: finalized.response
  };
};

const reconcilePendingFinalizations = async ({
  limit = 20,
  auth = null,
  requestId = "",
  force = false,
  source = "admin_reconciliation"
} = {}) => {
  const safeLimit = Math.max(
    1,
    Math.min(200, Number(limit || env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20))
  );
  const candidates = await Booking.find(
    buildPendingFinalizationQuery({
      force,
      nowIso: toIsoNow()
    })
  )
    .sort({
      "pendingCheckout.finalization.nextRetryAt": 1,
      updatedAt: 1
    })
    .limit(safeLimit);

  const summary = {
    requested: safeLimit,
    processed: 0,
    confirmed: 0,
    pendingRetry: 0,
    inProgress: 0,
    failed: 0
  };

  const results = [];

  for (const booking of candidates) {
    summary.processed += 1;

    try {
      const finalized = await finalizePendingBookingAfterPayment({
        bookingId: booking._id,
        transactionToken: String(booking.paymentTransactionId || booking.dpoTransactionToken || ""),
        paymentMethod: booking.paymentMethod || "pending",
        paymentProvider: booking.paymentMethod === "dpo" ? "dpo" : "pesapal",
        requestId,
        source,
        force,
        auditReason: "Booking reconciled after delayed Bokun finalization"
      });

      summary.confirmed += 1;
      results.push({
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        status: "confirmed",
        bokunBookingId: finalized.response?.bokunBookingId || ""
      });
    } catch (error) {
      const code = String(error?.code || "");
      const meta = extractFinalizationMetaFromError(error);

      if (code === "BOOKING_FINALIZATION_IN_PROGRESS") {
        summary.inProgress += 1;
      } else if (code === "BOKUN_FINALIZATION_PENDING") {
        summary.pendingRetry += 1;
      } else {
        summary.failed += 1;
      }

      results.push({
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        status:
          code === "BOOKING_FINALIZATION_IN_PROGRESS"
            ? "in_progress"
            : code === "BOKUN_FINALIZATION_PENDING"
              ? "pending_retry"
              : "failed",
        errorCode: code || meta.code || "UNKNOWN_ERROR",
        errorMessage: meta.message || error.message || "Finalization failed"
      });
    }
  }

  await AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "system",
    action: "booking_finalization_reconciliation_run",
    entityType: "Booking",
    entityId: "batch",
    reason: "Booking finalization reconciliation executed",
    requestId,
    metadata: {
      source,
      force: Boolean(force),
      summary
    }
  });

  return {
    summary,
    results
  };
};

module.exports = {
  quoteBooking,
  createBooking,
  preparePendingPaymentBooking,
  finalizePendingBookingAfterPayment,
  markBookingPaymentFailed,
  listPendingFinalizations,
  retryBookingFinalization,
  reconcilePendingFinalizations,
  getBookingByReference,
  listRecentBookings,
  cancelBooking,
  requestBookingEdit,
  bookingStats
};

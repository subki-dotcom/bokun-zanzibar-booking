const { normalizeBokunBookingStatus } = require("./bookingStatus.adapter");
const { mapBokunSalesChannel } = require("./salesChannel.adapter");

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const normalizeToken = (value = "") => String(value || "").trim();

const BOKUN_REPORTING_TIME_ZONE = "Africa/Dar_es_Salaam";

const EMPTY_OPERATIONAL_DATE = {
  raw: "",
  normalizedAt: null,
  localDate: "",
  localTime: ""
};

const unwrapBokunDateValue = (value) => {
  if (value instanceof Date || value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  return (
    value.isoDateTime ||
    value.localDateTime ||
    value.dateTime ||
    value.datetime ||
    value.isoDate ||
    value.localDate ||
    value.date ||
    value.time ||
    value.timestamp ||
    value.value ||
    value.raw ||
    ""
  );
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const candidate = unwrapBokunDateValue(value);
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate;
    if (candidate === null || candidate === undefined) continue;
    const token = typeof candidate === "object" ? candidate : normalizeToken(candidate);
    if (typeof token === "object" || token) return candidate;
  }
  return null;
};

const rawDateValue = (value) => {
  const candidate = unwrapBokunDateValue(value);
  if (candidate instanceof Date) return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
  if (candidate === null || candidate === undefined) return "";
  return normalizeToken(candidate);
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object") {
    return toNumberOrNull(value.amount ?? value.value ?? value.total ?? value.totalAmount);
  }

  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = toNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return 0;
};

const toDateOnly = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const toDateFromBokunValue = (value) => {
  const candidate = unwrapBokunDateValue(value);
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  const text = normalizeToken(candidate);
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const dateOnly = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }

  const numeric = Number(text);
  const parsed = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateParts = (date, options = {}) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return {};
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BOKUN_REPORTING_TIME_ZONE,
    ...options
  })
    .formatToParts(date)
    .reduce((parts, part) => {
      if (part.type !== "literal") {
        parts[part.type] = part.value;
      }
      return parts;
    }, {});
};

const formatLocalDate = (date) => {
  const parts = formatDateParts(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : "";
};

const formatLocalTime = (date) => {
  const parts = formatDateParts(date, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  if (!parts.hour || !parts.minute) return "";
  return `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
};

const hasExplicitTime = (value) => {
  const candidate = unwrapBokunDateValue(value);
  if (candidate instanceof Date) return true;
  const text = normalizeToken(candidate);
  return /\b([01]?\d|2[0-3]):([0-5]\d)\b/.test(text) || /\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(AM|PM)\b/i.test(text);
};

const normalizeOperationalDate = (value, { includeTime = true } = {}) => {
  const raw = rawDateValue(value);
  if (!raw) return { ...EMPTY_OPERATIONAL_DATE };

  const normalizedAt = toDateFromBokunValue(value);
  return {
    raw,
    normalizedAt,
    localDate: normalizedAt ? formatLocalDate(normalizedAt) : "",
    localTime: includeTime && normalizedAt && hasExplicitTime(value) ? formatLocalTime(normalizedAt) : ""
  };
};

const extractTime = (...values) => {
  for (const value of values) {
    const text = normalizeToken(unwrapBokunDateValue(value));
    if (!text) continue;
    const direct = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (direct) return `${direct[1].padStart(2, "0")}:${direct[2]}`;

    const ampm = text.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(AM|PM)\b/i);
    if (ampm) {
      let hour = Number(ampm[1]);
      const minutes = ampm[2] || "00";
      const marker = ampm[3].toUpperCase();
      if (marker === "PM" && hour < 12) hour += 12;
      if (marker === "AM" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${minutes}`;
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getUTCHours()).padStart(2, "0")}:${String(parsed.getUTCMinutes()).padStart(2, "0")}`;
    }
  }

  return "";
};

const normalizeOperationalTime = (value) => {
  const raw = rawDateValue(value);
  if (!raw) return { ...EMPTY_OPERATIONAL_DATE };

  const normalizedAt = toDateFromBokunValue(value);
  const parsedTime = extractTime(value);
  return {
    raw,
    normalizedAt,
    localDate: normalizedAt ? formatLocalDate(normalizedAt) : "",
    localTime: parsedTime || (normalizedAt ? formatLocalTime(normalizedAt) : "")
  };
};

const extractRoot = (bokunBooking = {}) => {
  const raw = bokunBooking?.raw || bokunBooking || {};
  return {
    raw,
    root: raw?.booking || raw
  };
};

const pickActivityBooking = (root = {}) => {
  const candidates = [
    root.activityBookings,
    root.productBookings,
    root.experienceBookings,
    root.routeBookings,
    root.accommodationBookings,
    root.carBookings
  ];

  for (const candidate of candidates) {
    const first = ensureArray(candidate)[0];
    if (first) return first;
  }

  return root.product || root.boxProduct || root.startDate || root.productConfirmationCode ? root : {};
};

const extractBokunOperationalDates = (root = {}, activity = {}) => {
  const bookingCreatedAtBokun = firstNonEmpty(
    root.creationDate,
    root.created,
    root.createdAt,
    root.bookingCreatedAt,
    root.bookingCreationDate,
    root.dateCreated
  );
  const bookingConfirmedAtBokun = firstNonEmpty(
    root.confirmationDate,
    root.confirmedAt,
    root.bookingConfirmedAt,
    root.confirmedDate
  );
  const travelDate = firstNonEmpty(
    activity.dateString,
    activity.date,
    activity.startDateTime,
    activity.startDate,
    root.startDate,
    root.date,
    root.travelDate
  );
  const activityDate = firstNonEmpty(
    activity.dateString,
    activity.date,
    activity.startDateTime,
    activity.startDate,
    root.startDate,
    root.date
  );
  const activityStartTime = firstNonEmpty(activity.startTime, activity.startDateTime, activity.startDate, activity.dateString);
  const pickupDate = firstNonEmpty(
    activity.pickupDate,
    activity.pickupDateTime,
    activity.pickupTime,
    root.pickupDate,
    root.pickupDateTime,
    root.pickupTime
  );
  const pickupTime = firstNonEmpty(activity.pickupTime, activity.pickupDateTime, root.pickupTime, root.pickupDateTime);
  const endTime = firstNonEmpty(activity.endTime, activity.endDateTime, root.endTime, root.endDateTime);
  const cancellationDate = firstNonEmpty(root.cancellationDate, root.cancelledAt, activity.cancellationDate);
  const amendmentDate = firstNonEmpty(root.amendmentDate, root.amendedAt, root.lastAmendedAt, activity.amendmentDate);
  const rescheduleDate = firstNonEmpty(root.rescheduleDate, root.rescheduledAt, activity.rescheduleDate, activity.rescheduledAt);
  const bokunLastModifiedAt = firstNonEmpty(
    root.lastModified,
    root.lastModifiedAt,
    root.modifiedAt,
    root.updatedAt,
    activity.lastModified,
    activity.lastModifiedAt
  );

  return {
    timezone: BOKUN_REPORTING_TIME_ZONE,
    bookingCreatedAtBokun: normalizeOperationalDate(bookingCreatedAtBokun),
    bookingConfirmedAtBokun: normalizeOperationalDate(bookingConfirmedAtBokun),
    travelDate: normalizeOperationalDate(travelDate, { includeTime: false }),
    activityDate: normalizeOperationalDate(activityDate, { includeTime: false }),
    activityStartTime: normalizeOperationalTime(activityStartTime),
    pickupDate: normalizeOperationalDate(pickupDate, { includeTime: false }),
    pickupTime: normalizeOperationalTime(pickupTime),
    endTime: normalizeOperationalTime(endTime),
    cancellationDate: normalizeOperationalDate(cancellationDate),
    amendmentDate: normalizeOperationalDate(amendmentDate),
    rescheduleDate: normalizeOperationalDate(rescheduleDate),
    bokunLastModifiedAt: normalizeOperationalDate(bokunLastModifiedAt),
    mappedAt: new Date()
  };
};

const extractCustomer = (root = {}, activity = {}) => {
  const customer = root.customer || root.customerInvoice?.recipient || activity.customer || {};
  const pickupPlace = activity.pickupPlace || activity.pickupLocation || root.pickupPlace || root.pickupLocation || {};
  const firstName = normalizeToken(customer.firstName || customer.givenName || customer.name?.firstName || "Guest") || "Guest";
  const lastName = normalizeToken(customer.lastName || customer.familyName || customer.name?.lastName || "Customer") || "Customer";

  return {
    firstName,
    lastName,
    email: normalizeToken(customer.email || customer.emailAddress || "").toLowerCase(),
    phone: normalizeToken(customer.phoneNumber || customer.phone || customer.mobilePhone || ""),
    country: normalizeToken(customer.country?.isoCode || customer.country?.code || customer.country || customer.nationality || ""),
    hotelName: normalizeToken(activity.pickupPlaceDescription || root.pickupPlaceDescription || pickupPlace.title || pickupPlace.name || ""),
    pickupPlaceId: normalizeToken(pickupPlace.id || pickupPlace.pickupPlaceId || "")
  };
};

const normalizeTicketCategory = (value = "") => {
  const token = String(value || "").toLowerCase();
  if (token.includes("adult")) return "adult";
  if (token.includes("child")) return "child";
  if (token.includes("infant") || token.includes("baby")) return "infant";
  return "other";
};

const extractParticipants = (root = {}, activity = {}) => {
  const sourceRows = [
    ...ensureArray(activity.pricingCategoryBookings),
    ...ensureArray(activity.passengers),
    ...ensureArray(activity.participants),
    ...ensureArray(root.pricingCategoryBookings)
  ];

  const rows = sourceRows
    .map((row = {}, index) => {
      const category = row.pricingCategory || row.category || row.passengerCategory || {};
      const title = normalizeToken(row.bookedTitle || row.title || category.title || category.name || row.ticketCategory || "Passenger");
      const ticketCategory = normalizeToken(category.ticketCategory || row.ticketCategory || title).toUpperCase();
      const quantity = Math.max(0, Number(row.quantity ?? row.occupancy ?? row.count ?? 0));
      return {
        categoryId: normalizeToken(row.pricingCategoryId || category.id || row.categoryId || row.id || `category-${index + 1}`),
        title,
        ticketCategory,
        quantity
      };
    })
    .filter((row) => row.quantity > 0);

  const paxSummary = rows.reduce(
    (summary, row) => {
      const category = normalizeTicketCategory(`${row.ticketCategory} ${row.title}`);
      if (category === "adult") summary.adults += row.quantity;
      else if (category === "child") summary.children += row.quantity;
      else if (category === "infant") summary.infants += row.quantity;
      summary.total += row.quantity;
      return summary;
    },
    { adults: 0, children: 0, infants: 0, total: 0 }
  );

  if (!rows.length) {
    const total = Math.max(0, Number(root.totalParticipants || root.participantCount || activity.participantCount || 0));
    paxSummary.adults = total;
    paxSummary.total = total;
  }

  return {
    priceCategoryParticipants: rows,
    paxSummary
  };
};

const extractMoney = (root = {}, activity = {}) => {
  const invoice = root.customerInvoice || root.invoice || {};
  const total = firstNumber(
    root.totalPrice,
    root.priceWithDiscount,
    root.total,
    root.totalAsMoney,
    invoice.total,
    invoice.totalAsMoney,
    activity.totalPrice,
    activity.priceWithDiscount,
    activity.totalPriceAsMoney
  );
  const paidAmount = firstNumber(
    root.paidAmount,
    root.totalPaid,
    root.paidAmountAsMoney,
    invoice.paidAmountAsMoney,
    invoice.paidAmount,
    activity.paidAmount
  );
  const discountAmount = firstNumber(root.discountAmount, invoice.totalDiscount, invoice.totalDiscountAsMoney);
  const currency =
    normalizeToken(root.currency || invoice.currency || invoice.totalAsMoney?.currency || activity.currency || "USD").toUpperCase() || "USD";

  return {
    amount: total,
    paidAmount,
    discountAmount,
    currency
  };
};

const paymentStatusFromBokun = ({ amount = 0, paidAmount = 0 } = {}) => {
  if (paidAmount <= 0) return "pending";
  if (amount > 0 && paidAmount + 0.009 < amount) return "partial";
  return "paid";
};

const lowerSalesChannel = (salesChannel = "OTHER") => String(salesChannel || "OTHER").toLowerCase();

const mapBokunBookingForImport = ({ bokunBooking = {}, fallbackSalesChannel = "" } = {}) => {
  const { raw, root } = extractRoot(bokunBooking);
  const status = normalizeBokunBookingStatus(raw);
  const activity = pickActivityBooking(root);
  const product = activity.product || activity.activity || activity.boxProduct || root.product || root.boxProduct || {};
  const rate = activity.rate || activity.option || {};
  const bookingReference = normalizeToken(
    root.externalBookingReference ||
      bokunBooking.bookingReference ||
      root.bookingReference ||
      root.reference ||
      root.confirmationCode ||
      root.id ||
      bokunBooking.bokunBookingId
  );
  const bokunBookingId = normalizeToken(root.bookingId || root.id || bokunBooking.bokunBookingId);
  const confirmationCode = normalizeToken(root.confirmationCode || bokunBooking.confirmationCode || root.bookingReference || "");
  const bokunProductId = normalizeToken(activity.productId || product.id || product.productId || activity.experienceId || "");
  const bokunOptionId = normalizeToken(activity.rateId || rate.id || activity.optionId || activity.productConfirmationCode || "");
  const productTitle = normalizeToken(activity.title || product.title || product.name || root.productTitle || "Bokun experience");
  const optionTitle = normalizeToken(activity.rateTitle || rate.title || rate.name || activity.optionTitle || "Booked option");
  const bokunOperationalDates = extractBokunOperationalDates(root, activity);
  const travelDate = bokunOperationalDates.travelDate.localDate || [activity.dateString, activity.date, activity.startDateTime, activity.startDate, root.startDate, root.date]
    .map((candidate) => toDateOnly(candidate))
    .find(Boolean) || "";
  const startTime =
    bokunOperationalDates.activityStartTime.localTime ||
    extractTime(activity.startTime, activity.startDateTime, activity.startDate, activity.dateString, root.startDate);
  const money = extractMoney(root, activity);
  const participants = extractParticipants(root, activity);
  const customer = extractCustomer(root, activity);
  const channel = mapBokunSalesChannel(root, fallbackSalesChannel);
  const cancellationDate =
    bokunOperationalDates.cancellationDate.normalizedAt || root.cancellationDate || root.cancelledAt || activity.cancellationDate || null;
  const bokunExternalBookingReference = normalizeToken(root.externalBookingReference || bokunBooking.bookingReference || "");
  const externalChannelReference = normalizeToken(
    root.externalBookingEntityCode ||
      root.externalBookingEntityName ||
      root.integratedSystem?.id ||
      root.channel?.id ||
      root.bookingChannel?.id ||
      ""
  );
  const lineItems = [
    {
      label: optionTitle || productTitle,
      quantity: participants.paxSummary.total || 1,
      unitPrice: money.amount,
      total: money.amount,
      amount: money.amount
    }
  ];
  const validationErrors = [];

  if (!bookingReference) validationErrors.push("bookingReference");
  if (!bokunBookingId) validationErrors.push("bokunBookingId");
  if (!confirmationCode) validationErrors.push("confirmationCode");
  if (!bokunProductId) validationErrors.push("bokunProductId");
  if (!bokunOptionId) validationErrors.push("bokunOptionId");
  if (!travelDate) validationErrors.push("travelDate");
  if (!Number.isFinite(money.amount) || money.amount < 0) validationErrors.push("amount");

  return {
    raw,
    root,
    activity,
    status,
    channel,
    validationErrors,
    isImportableConfirmed: status.operationallyConfirmed && validationErrors.length === 0,
    isCancellableSync: status.cancelled && Boolean(bokunBookingId || confirmationCode || bookingReference),
    snapshot: {
      bookingReference,
      bokunBookingId,
      confirmationCode,
      bokunProductId,
      bokunOptionId,
      productTitle,
      optionTitle,
      travelDate,
      startTime,
      priceCatalog: {
        activityPriceCatalogId: normalizeToken(activity.activityPriceCatalogId || ""),
        catalogId: normalizeToken(activity.catalogId || ""),
        title: normalizeToken(activity.priceCatalogTitle || optionTitle || "Bokun")
      },
      paxSummary: participants.paxSummary,
      priceCategoryParticipants: participants.priceCategoryParticipants,
      pricingSnapshot: {
        currency: money.currency,
        baseAmount: money.amount,
        extraAmount: 0,
        grossAmount: money.amount,
        discountAmount: money.discountAmount,
        subsidyAmount: 0,
        finalPayable: money.amount,
        amountPaid: money.paidAmount,
        lineItems
      },
      customer,
      amount: money.amount,
      amountPaid: money.paidAmount,
      currency: money.currency,
      paymentStatus: paymentStatusFromBokun({ amount: money.amount, paidAmount: money.paidAmount }),
      paymentMethod: normalizeToken(root.paidType || root.paymentType || "bokun_channel"),
      sourceChannel: lowerSalesChannel(channel.salesChannel),
      salesChannel: channel.salesChannel,
      rawSalesChannel: channel.rawChannel,
      rawChannelSource: channel.rawChannel || "",
      bokunExternalBookingReference,
      externalChannelReference,
      bokunOperationalDates,
      cancellationDate,
      rawBokunResponse: raw
    }
  };
};

const resolveBookingLookupReference = (raw = {}) => {
  const root = raw?.booking || raw?.raw?.booking || raw?.raw || raw || {};
  return normalizeToken(
    root.confirmationCode ||
      raw.confirmationCode ||
      root.bookingReference ||
      root.id ||
      root.bookingId ||
      root.externalBookingReference ||
      ""
  );
};

const normalizeBookingSearchItems = (response = {}) => {
  if (Array.isArray(response)) return response;

  const candidateKeys = ["items", "results", "bookings", "content", "data", "entries"];
  for (const key of candidateKeys) {
    if (Array.isArray(response?.[key])) return response[key];
  }

  return [];
};

const extractTotalCount = (response = {}) => {
  const value = firstNumber(
    response.totalCount,
    response.total,
    response.totalHits,
    response.totalResults,
    response.count,
    response.pagination?.total,
    response.page?.totalElements
  );
  return value || null;
};

module.exports = {
  mapBokunBookingForImport,
  resolveBookingLookupReference,
  normalizeBookingSearchItems,
  extractTotalCount,
  __testables: {
    toDateOnly,
    extractTime,
    normalizeOperationalDate,
    extractBokunOperationalDates,
    extractParticipants,
    paymentStatusFromBokun
  }
};

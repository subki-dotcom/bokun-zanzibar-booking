const TIMEZONE = "Africa/Dar_es_Salaam";
const POLICY_UNAVAILABLE_MESSAGE =
  "This booking requires cancellation review. Please contact our support team.";

const number = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const money = (value) => {
  const parsed = number(value);
  return parsed === null ? null : Number(parsed.toFixed(2));
};

const POLICY_TEXT_KEYS = [
  "policyDescription",
  "description",
  "summary",
  "text",
  "terms",
  "cancellationTerms",
  "label",
  "title",
  "name"
];

const extractPolicyText = (value, depth = 0, seen = new Set()) => {
  if (value === null || value === undefined || depth > 5) return "";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return /^\[object(?:\s+\w+)?\]$/i.test(text) ? "" : text;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractPolicyText(item, depth + 1, seen))
      .filter(Boolean)
      .join(" ");
  }
  if (!isObject(value) || seen.has(value)) return "";

  seen.add(value);
  for (const key of POLICY_TEXT_KEYS) {
    const text = extractPolicyText(value[key], depth + 1, seen);
    if (text) return text;
  }
  return "";
};

const stripHtml = (value = "") =>
  extractPolicyText(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

const ensureArray = (value) => (Array.isArray(value) ? value : []);
function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

const normalizeUnit = (value = "") => {
  const unit = String(value || "").toLowerCase();
  if (unit.startsWith("day")) return "days";
  if (unit.startsWith("hour") || unit === "hr" || unit === "hrs") return "hours";
  return "";
};

const toHours = (value, unit = "hours") => {
  const parsed = number(value);
  if (parsed === null || parsed < 0) return null;
  const normalizedUnit = normalizeUnit(unit) || "hours";
  return normalizedUnit === "days" ? parsed * 24 : parsed;
};

const zonedParts = (date, timeZone = TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value);
    return acc;
  }, {});
};

const parseTravelDate = (travelDate = "") => {
  const match = String(travelDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const parseStartTime = (startTime = "", fallbackEndOfDay = false) => {
  const match = String(startTime || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallbackEndOfDay ? { hour: 23, minute: 59 } : null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};

const zonedTimeToUtc = ({ travelDate = "", startTime = "", timeZone = TIMEZONE, fallbackEndOfDay = false } = {}) => {
  const dateParts = parseTravelDate(travelDate);
  const timeParts = parseStartTime(startTime, fallbackEndOfDay);
  if (!dateParts || !timeParts) return null;

  const targetUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0
  );
  let guess = new Date(targetUtc);

  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(guess, timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0
    );
    const diff = targetUtc - actualUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return Number.isNaN(guess.getTime()) ? null : guess;
};

const formatZonedIso = (date, timeZone = TIMEZONE) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = zonedParts(date, timeZone);
  const wallUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
  const offsetMinutes = Math.round((wallUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (value) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second || 0)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

const normalizeNow = (now = new Date()) => {
  if (now instanceof Date) return now;
  if (typeof now?.toDate === "function") return now.toDate();
  const parsed = new Date(now);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getTravelStartDate = (booking = {}, options = {}) =>
  zonedTimeToUtc({
    travelDate: booking.travelDate,
    startTime: booking.startTime,
    timeZone: options.timeZone || TIMEZONE,
    fallbackEndOfDay: Boolean(options.fallbackEndOfDay)
  });

const candidateHasPolicySignal = (value = {}) =>
  isObject(value) &&
  Object.keys(value).some((key) => /cancel|refund|policy|terms|penalt|cutoff/i.test(key));

const pickString = (...values) => values.map(stripHtml).find(Boolean) || "";

const findRatePolicy = ({ rawProduct = {}, booking = {} } = {}) => {
  const rateId = String(
    booking?.priceCatalog?.catalogId ||
      booking?.priceCatalog?.activityPriceCatalogId ||
      booking?.priceCatalogId ||
      ""
  );
  if (!rateId) return null;
  return ensureArray(rawProduct.rates || rawProduct.rateOptions)
    .find((rate = {}) => String(rate.id || rate.rateId || rate.activityRateId || "") === rateId) || null;
};

const extractPolicyCandidate = (value, source = "unknown", booking = {}, depth = 0) => {
  if (!value || depth > 4) return null;
  if (typeof value === "string") {
    const description = stripHtml(value);
    return description ? { source, rawPolicy: value, policyDescription: description } : null;
  }
  if (!isObject(value)) return null;

  if (value.rawPolicy) {
    const nested = extractPolicyCandidate(value.rawPolicy, value.source || source, booking, depth + 1);
    if (nested) return nested;
  }

  const directPolicy =
    value.cancellationPolicy ||
    value.cancellationPolicyRule ||
    value.cancellationTerms ||
    value.refundPolicy ||
    value.refundTerms ||
    value.policy;
  if (directPolicy && directPolicy !== value) {
    const nested = extractPolicyCandidate(directPolicy, `${source}_policy`, booking, depth + 1);
    if (nested) return nested;
  }

  const ratePolicy = findRatePolicy({ rawProduct: value, booking });
  if (ratePolicy && ratePolicy !== value) {
    const nested = extractPolicyCandidate(ratePolicy, `${source}_rate`, booking, depth + 1);
    if (nested) return nested;
  }

  if (candidateHasPolicySignal(value) || /cancel|refund|policy|terms/i.test(source)) {
    return {
      source,
      rawPolicy: value,
      policyName: pickString(value.name, value.title, value.policyName),
      policyDescription: pickString(
        value.description,
        value.policyDescription,
        value.terms,
        value.text,
        value.label,
        value.cancellationTerms
      ),
      policyType: String(value.type || value.policyType || value.kind || "").toLowerCase()
    };
  }

  for (const [key, child] of Object.entries(value)) {
    if (!/cancel|refund|policy|terms/i.test(key)) continue;
    const nested = extractPolicyCandidate(child, `${source}_${key}`, booking, depth + 1);
    if (nested) return nested;
  }

  return null;
};

const collectRuleArrays = (rawPolicy = {}) => {
  if (!isObject(rawPolicy)) return [];
  return [
    ...ensureArray(rawPolicy.rules),
    ...ensureArray(rawPolicy.penaltyRules),
    ...ensureArray(rawPolicy.cancellationRules),
    ...ensureArray(rawPolicy.refundRules),
    ...ensureArray(rawPolicy.terms)
  ];
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const parseCutoffFromText = (text = "") => {
  const value = stripHtml(text);
  if (!value) return null;
  const freeSignal = /free cancellation|full refund|100%\s*(refundable|refund)|fully refundable/i.test(value);
  const beforeMatch =
    value.match(/(?:at least|up to|until|before)\s+(\d+(?:\.\d+)?)\s*(hour|hours|day|days)\s+before/i) ||
    value.match(/(\d+(?:\.\d+)?)\s*(hour|hours|day|days)\s+before/i) ||
    value.match(/(\d+(?:\.\d+)?)\s*(hour|hours|day|days)\s+in advance/i);
  if (freeSignal && beforeMatch) {
    return {
      value: Number(beforeMatch[1]),
      unit: normalizeUnit(beforeMatch[2]),
      derivedFromText: true
    };
  }
  if (freeSignal && /before (the )?(event|departure|experience|tour) happens|until (the )?(event|departure|experience|tour)/i.test(value)) {
    return { value: 0, unit: "hours", derivedFromText: true };
  }
  return null;
};

const normalizeRule = (rule = {}) => {
  if (!isObject(rule)) return null;
  const cutoffValue = firstNumber(
    rule.cutoffValue,
    rule.cutoff,
    rule.cutoffHours,
    rule.hoursBefore,
    rule.hoursBeforeDeparture,
    rule.deadlineHours,
    rule.beforeDepartureHours,
    rule.daysBefore !== undefined ? Number(rule.daysBefore) : undefined
  );
  const cutoffUnit = rule.daysBefore !== undefined ? "days" : normalizeUnit(rule.cutoffUnit || rule.unit || "hours") || "hours";
  const cutoffHours = toHours(cutoffValue, cutoffUnit);
  const chargeType = String(rule.chargeType || rule.feeType || "").trim().toLowerCase();
  const refundPercentage = firstNumber(rule.refundPercentage, rule.refundPercent, rule.refundablePercentage);
  const penaltyPercentage = firstNumber(
    rule.penaltyPercentage,
    rule.penaltyPercent,
    rule.feePercentage,
    rule.chargePercentage,
    rule.percentage,
    chargeType.includes("percent") ? rule.charge : undefined
  );
  const feeAmount = firstNumber(
    rule.feeAmount,
    rule.cancellationFee,
    rule.penaltyAmount,
    chargeType && !chargeType.includes("percent") ? rule.charge : undefined
  );
  const description = pickString(rule.description, rule.text, rule.label, rule.name);

  if (cutoffHours === null && refundPercentage === null && penaltyPercentage === null && feeAmount === null && !description) {
    return null;
  }

  return {
    cutoffValue,
    cutoffUnit,
    cutoffHours,
    refundPercentage,
    penaltyPercentage,
    feeAmount,
    description
  };
};

const deriveCutoffFromPenaltyRules = (rules = []) => {
  const penalizedRules = ensureArray(rules).filter((rule) => {
    if (rule.cutoffHours === null || rule.cutoffHours === undefined) return false;
    if (rule.penaltyPercentage !== null && rule.penaltyPercentage !== undefined) {
      return Number(rule.penaltyPercentage) > 0;
    }
    if (rule.feeAmount !== null && rule.feeAmount !== undefined) return Number(rule.feeAmount) > 0;
    if (rule.refundPercentage !== null && rule.refundPercentage !== undefined) {
      return Number(rule.refundPercentage) < 100;
    }
    return false;
  });
  if (!penalizedRules.length) return null;

  const firstPenaltyWindow = penalizedRules.reduce((selected, rule) =>
    !selected || Number(rule.cutoffHours) > Number(selected.cutoffHours) ? rule : selected, null);
  return {
    value: Number(firstPenaltyWindow.cutoffHours),
    unit: "hours",
    derivedFromText: false,
    derivedFromPenaltyRules: true
  };
};

const extractStructuredCutoff = (rawPolicy = {}) => {
  if (!isObject(rawPolicy)) return null;
  const nestedCutoff = isObject(rawPolicy.cutoff) ? rawPolicy.cutoff : {};
  const value = firstNumber(
    rawPolicy.freeCancellationCutoffValue,
    rawPolicy.freeCancellationCutoff,
    rawPolicy.cancellationCutoffValue,
    rawPolicy.cancellationCutoff,
    rawPolicy.cutoffValue,
    rawPolicy.cutoffHours,
    rawPolicy.cancellationCutoffHours,
    rawPolicy.freeCancellationCutoffHours,
    rawPolicy.hoursBeforeDeparture,
    rawPolicy.hoursBefore,
    nestedCutoff.value,
    nestedCutoff.amount,
    rawPolicy.cutoffDays !== undefined ? Number(rawPolicy.cutoffDays) : undefined
  );
  const unit = rawPolicy.cutoffDays !== undefined
    ? "days"
    : normalizeUnit(
        rawPolicy.freeCancellationCutoffUnit ||
          rawPolicy.cancellationCutoffUnit ||
          rawPolicy.cutoffUnit ||
          nestedCutoff.unit ||
          "hours"
      ) || "hours";
  if (value === null) return null;
  return { value, unit, derivedFromText: false };
};

const normalizePolicySource = ({ booking = {}, productSnapshot = null } = {}) => {
  const bookingSnapshot = booking.cancellationPolicySnapshot || null;
  const productText = productSnapshot?.cancellationPolicy || "";
  const rawProduct = productSnapshot?.rawBokunProduct || productSnapshot || null;
  const candidates = [
    extractPolicyCandidate(bookingSnapshot, "booking_policy_snapshot", booking),
    extractPolicyCandidate(booking.rawBokunResponse, "bokun_booking_response", booking),
    extractPolicyCandidate(rawProduct, "bokun_product_snapshot", booking),
    extractPolicyCandidate(productText, "bokun_product_text", booking)
  ].filter(Boolean);

  const selected = candidates.find((candidate) => candidate.policyDescription || candidate.rawPolicy) || null;
  if (!selected) {
    return {
      policyAvailable: false,
      requiresManualReview: true,
      policyName: "",
      policyDescription: "",
      policyType: "",
      source: "none",
      sourceMessage: POLICY_UNAVAILABLE_MESSAGE,
      rawPolicy: null,
      cutoff: null,
      penaltyRules: [],
      refundable: null
    };
  }

  const rawPolicy = selected.rawPolicy;
  const description = pickString(
    selected.policyDescription,
    rawPolicy?.description,
    rawPolicy?.policyDescription,
    rawPolicy?.terms,
    productText
  );
  const textCutoff = parseCutoffFromText(description);
  const structuredCutoff = extractStructuredCutoff(rawPolicy);
  const normalizedRules = collectRuleArrays(rawPolicy).map(normalizeRule).filter(Boolean);
  const ruleCutoff = deriveCutoffFromPenaltyRules(normalizedRules);
  const cutoff = structuredCutoff || textCutoff || ruleCutoff;
  const policyType = String(selected.policyType || rawPolicy?.type || rawPolicy?.policyType || "").toLowerCase();
  const scopedNoRefund = /no refunds?\s+(within|inside|after|before|less than)/i.test(description);
  const nonRefundable =
    /non[-\s]?refundable|0%\s*(refund|refundable)/i.test(description) ||
    (/no refunds?/i.test(description) && !scopedNoRefund) ||
    /non/.test(policyType);
  const external = /external|manual|contact/i.test(policyType) || /contact (us|support)|managed directly|requires review/i.test(description);

  return {
    policyAvailable: true,
    requiresManualReview: Boolean(external),
    policyName: pickString(selected.policyName, rawPolicy?.name, rawPolicy?.title),
    policyDescription: description,
    policyType,
    source: selected.source,
    sourceMessage: "",
    rawPolicy,
    cutoff,
    penaltyRules: normalizedRules,
    refundable: nonRefundable ? false : null,
    derivedFromPolicyText: Boolean(cutoff?.derivedFromText),
    derivedFromPenaltyRules: Boolean(cutoff?.derivedFromPenaltyRules)
  };
};

const pickRefundRule = ({ policy, hoursUntilTravel }) => {
  const rules = ensureArray(policy.penaltyRules)
    .filter((rule) => rule.cutoffHours !== null && rule.cutoffHours !== undefined)
    .sort((a, b) => Number(a.cutoffHours || 0) - Number(b.cutoffHours || 0));
  return rules.find((rule) => hoursUntilTravel < Number(rule.cutoffHours || 0)) || null;
};

const formatCutoffLabel = (cutoff = {}) => {
  const hours = toHours(cutoff.value, cutoff.unit);
  if (hours === null) return "";
  if (hours >= 48 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
};

const buildPolicySummary = (policy = {}) => {
  if (!policy.derivedFromPenaltyRules || !policy.cutoff) {
    return policy.policyDescription ||
      (policy.cutoff
        ? `Free cancellation until ${policy.cutoff.value} ${policy.cutoff.unit} before departure`
        : POLICY_UNAVAILABLE_MESSAGE);
  }

  const cutoffLabel = formatCutoffLabel(policy.cutoff);
  const firstPenaltyRule = ensureArray(policy.penaltyRules)
    .filter((rule) => Number(rule.cutoffHours) === Number(policy.cutoff.value))
    .find((rule) => Number(rule.penaltyPercentage || 0) > 0 || Number(rule.feeAmount || 0) > 0);
  const penaltyLabel = firstPenaltyRule?.penaltyPercentage !== null && firstPenaltyRule?.penaltyPercentage !== undefined
    ? `${Number(firstPenaltyRule.penaltyPercentage)}% cancellation fee`
    : "a cancellation fee";
  const title = policy.policyDescription ? `${policy.policyDescription}. ` : "";
  return `${title}Free cancellation is available until ${cutoffLabel} before departure. ${penaltyLabel} applies when cancelled less than ${cutoffLabel} before departure.`;
};

const buildTimeRemainingLabel = (deadline, now) => {
  if (!deadline || deadline.getTime() < now.getTime()) return "";
  const minutes = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const pieces = [];
  if (days) pieces.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) pieces.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (!pieces.length && mins) pieces.push(`${mins} ${mins === 1 ? "minute" : "minutes"}`);
  return pieces.length ? pieces.slice(0, 2).join(", ") : "less than 1 minute";
};

const publicPolicy = (policy) => {
  const {
    rawPolicy,
    cutoff,
    ...safe
  } = policy || {};
  return {
    ...safe,
    freeCancellationCutoffValue: cutoff?.value ?? safe.freeCancellationCutoffValue ?? null,
    freeCancellationCutoffUnit: cutoff?.unit || safe.freeCancellationCutoffUnit || "",
    cutoffValue: cutoff?.value ?? safe.cutoffValue ?? null,
    cutoffUnit: cutoff?.unit || safe.cutoffUnit || ""
  };
};

const calculateCancellationPolicy = ({
  booking = {},
  productSnapshot = null,
  amountPaid = undefined,
  now = new Date(),
  timeZone = TIMEZONE
} = {}) => {
  const serverNow = normalizeNow(now);
  const policy = normalizePolicySource({ booking, productSnapshot });
  const amount = money(amountPaid ?? booking?.invoiceSnapshot?.amountPaid ?? booking?.pricingSnapshot?.amountPaid ?? 0) || 0;
  const travelStart = getTravelStartDate(booking, { timeZone });
  const hasStartTime = Boolean(parseStartTime(booking?.startTime || ""));
  const hoursUntilTravel = travelStart ? (travelStart.getTime() - serverNow.getTime()) / 36e5 : null;
  const bookingAlreadyStarted = travelStart ? serverNow.getTime() > travelStart.getTime() : false;
  const deadline = policy.cutoff && travelStart
    ? new Date(travelStart.getTime() - toHours(policy.cutoff.value, policy.cutoff.unit) * 36e5)
    : null;
  const isFreeCancellationAvailable =
    Boolean(deadline) &&
    serverNow.getTime() <= deadline.getTime() &&
    policy.refundable !== false &&
    !policy.requiresManualReview;
  const freeCancellationExpired =
    Boolean(deadline) &&
    serverNow.getTime() > deadline.getTime();

  let refundPercentage = null;
  let estimatedRefundAmount = null;
  let estimatedCancellationFee = null;
  let requiresManualReview = Boolean(policy.requiresManualReview || !policy.policyAvailable || !travelStart || !hasStartTime);
  let reviewReason = policy.sourceMessage || "";

  if (!hasStartTime) {
    reviewReason = "Cancellation terms require manual review because the booking start time is missing.";
  } else if (!policy.policyAvailable) {
    reviewReason = POLICY_UNAVAILABLE_MESSAGE;
  } else if (bookingAlreadyStarted) {
    requiresManualReview = true;
    reviewReason = "This tour has already started, so cancellation requires support review.";
  } else if (policy.refundable === false) {
    refundPercentage = 0;
    estimatedRefundAmount = 0;
    estimatedCancellationFee = amount;
    reviewReason = "This booking is non-refundable according to the applicable cancellation policy.";
  } else if (isFreeCancellationAvailable) {
    refundPercentage = 100;
    estimatedRefundAmount = amount;
    estimatedCancellationFee = 0;
  } else {
    const rule = pickRefundRule({ policy, hoursUntilTravel });
    if (rule) {
      if (rule.refundPercentage !== null && rule.refundPercentage !== undefined) {
        refundPercentage = Math.min(100, Math.max(0, Number(rule.refundPercentage)));
        estimatedRefundAmount = money((amount * refundPercentage) / 100);
        estimatedCancellationFee = money(amount - estimatedRefundAmount);
      } else if (rule.penaltyPercentage !== null && rule.penaltyPercentage !== undefined) {
        const penalty = Math.min(100, Math.max(0, Number(rule.penaltyPercentage)));
        refundPercentage = 100 - penalty;
        estimatedCancellationFee = money((amount * penalty) / 100);
        estimatedRefundAmount = money(amount - estimatedCancellationFee);
      } else if (rule.feeAmount !== null && rule.feeAmount !== undefined) {
        estimatedCancellationFee = money(Math.min(amount, Number(rule.feeAmount)));
        estimatedRefundAmount = money(amount - estimatedCancellationFee);
        refundPercentage = amount > 0 ? money((estimatedRefundAmount / amount) * 100) : null;
      }
    }

    if (estimatedRefundAmount === null) {
      requiresManualReview = true;
      reviewReason = freeCancellationExpired
        ? "Free cancellation period has ended. Cancellation may now be non-refundable or subject to review."
        : POLICY_UNAVAILABLE_MESSAGE;
    }
  }

  const nonRefundableAmount =
    estimatedCancellationFee === null && estimatedRefundAmount !== null
      ? money(amount - estimatedRefundAmount)
      : estimatedCancellationFee;
  const policySummary = buildPolicySummary(policy);

  return publicPolicy({
    ...policy,
    normalizedVersion: 1,
    timezone: timeZone,
    serverTime: formatZonedIso(serverNow, timeZone),
    travelStart: formatZonedIso(travelStart, timeZone),
    deadline: formatZonedIso(deadline, timeZone),
    policySummary,
    amountPaid: amount,
    currency: booking.currency || booking.pricingSnapshot?.currency || "USD",
    isFreeCancellationAvailable,
    isCancellationAllowed: !bookingAlreadyStarted,
    freeCancellationExpired,
    requiresManualReview,
    reviewReason,
    refundable: policy.refundable === false ? false : estimatedRefundAmount !== null ? estimatedRefundAmount > 0 : policy.refundable,
    refundPercentage,
    estimatedCancellationFee,
    estimatedRefundAmount,
    nonRefundableAmount,
    timeRemainingLabel: buildTimeRemainingLabel(deadline, serverNow),
    automaticCancellationAllowed:
      isFreeCancellationAvailable &&
      !requiresManualReview &&
      amount > 0 &&
      estimatedRefundAmount === amount,
    source: policy.source,
    bokunProductId: String(booking.bokunProductId || productSnapshot?.bokunProductId || ""),
    bokunOptionId: String(booking.bokunOptionId || ""),
    bokunBookingId: String(booking.bokunBookingId || "")
  });
};

module.exports = {
  TIMEZONE,
  POLICY_UNAVAILABLE_MESSAGE,
  calculateCancellationPolicy,
  formatZonedIso,
  getTravelStartDate,
  normalizePolicySource,
  stripHtml,
  zonedTimeToUtc
};

const AppError = require("../utils/AppError");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_PERIOD,
  ANALYTICS_RANGE_BOUNDARY,
  ANALYTICS_TIME_ZONE
} = require("./constants");

const normalizeToken = (value = "") => String(value || "").trim().toUpperCase();

const isDateOnly = (value = "") => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());

const assertKnown = ({ value, values, fallback, code, label }) => {
  const token = normalizeToken(value || fallback);
  if (Object.values(values).includes(token)) return token;
  throw new AppError(`${label} is not supported`, 422, code, { value });
};

const zonedPartsFormatter = (timeZone = ANALYTICS_TIME_ZONE) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

const datePartsInTimeZone = (date = new Date(), timeZone = ANALYTICS_TIME_ZONE) => {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("Analytics date is invalid", 422, "ANALYTICS_DATE_INVALID");
  }

  const parts = zonedPartsFormatter(timeZone).formatToParts(parsed).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
};

const timeZoneOffsetMs = (date = new Date(), timeZone = ANALYTICS_TIME_ZONE) => {
  const parts = datePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};

const zonedDateTimeToUtc = (
  { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 },
  timeZone = ANALYTICS_TIME_ZONE
) => {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let utc = localAsUtc;
  for (let index = 0; index < 3; index += 1) {
    utc = localAsUtc - timeZoneOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
};

const ymdFromUtc = (date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate()
});

const addDays = ({ year, month, day }, days = 0) => ymdFromUtc(new Date(Date.UTC(year, month - 1, day + days)));

const addMonths = ({ year, month, day = 1 }, months = 0) =>
  ymdFromUtc(new Date(Date.UTC(year, month - 1 + months, day)));

const startOfLocalDay = (parts, timeZone = ANALYTICS_TIME_ZONE) =>
  zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day }, timeZone);

const startOfLocalWeek = (parts, timeZone = ANALYTICS_TIME_ZONE) => {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return startOfLocalDay(addDays(parts, -daysSinceMonday), timeZone);
};

const startOfLocalMonth = (parts, timeZone = ANALYTICS_TIME_ZONE) =>
  startOfLocalDay({ year: parts.year, month: parts.month, day: 1 }, timeZone);

const startOfLocalQuarter = (parts, timeZone = ANALYTICS_TIME_ZONE) => {
  const quarterStartMonth = Math.floor((parts.month - 1) / 3) * 3 + 1;
  return startOfLocalDay({ year: parts.year, month: quarterStartMonth, day: 1 }, timeZone);
};

const startOfLocalYear = (parts, timeZone = ANALYTICS_TIME_ZONE) =>
  startOfLocalDay({ year: parts.year, month: 1, day: 1 }, timeZone);

const parseAnalyticsDate = ({ value, timeZone = ANALYTICS_TIME_ZONE, dateOnlyEndExclusive = false, field = "date" }) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new AppError(`Analytics ${field} is invalid`, 422, "ANALYTICS_DATE_INVALID", { field });
    }
    return value;
  }

  const text = String(value || "").trim();
  if (!text) {
    throw new AppError(`Analytics ${field} is required`, 422, "ANALYTICS_DATE_REQUIRED", { field });
  }

  if (isDateOnly(text)) {
    const [year, month, day] = text.split("-").map(Number);
    const parts = dateOnlyEndExclusive ? addDays({ year, month, day }, 1) : { year, month, day };
    return startOfLocalDay(parts, timeZone);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Analytics ${field} is invalid`, 422, "ANALYTICS_DATE_INVALID", { field, value });
  }
  return parsed;
};

const buildRange = ({ period, from = null, to = null, timeZone, label, warnings = [] }) => {
  const isBounded = Boolean(from && to);
  if (isBounded && !(to.getTime() > from.getTime())) {
    throw new AppError("Analytics period end must be after start", 422, "ANALYTICS_PERIOD_RANGE_INVALID");
  }

  return {
    period,
    label,
    timeZone,
    boundary: ANALYTICS_RANGE_BOUNDARY,
    from,
    to,
    fromIso: from ? from.toISOString() : null,
    toIso: to ? to.toISOString() : null,
    isBounded,
    warnings
  };
};

const resolveCustomRange = ({ period, from, to, timeZone, label }) =>
  buildRange({
    period,
    timeZone,
    label,
    from: parseAnalyticsDate({ value: from, timeZone, field: "from" }),
    to: parseAnalyticsDate({ value: to, timeZone, dateOnlyEndExclusive: isDateOnly(to), field: "to" })
  });

const resolveAnalyticsPeriod = ({
  period = ANALYTICS_PERIOD.THIS_MONTH,
  from = "",
  to = "",
  now = new Date(),
  timeZone = ANALYTICS_TIME_ZONE
} = {}) => {
  const normalizedPeriod = assertKnown({
    value: period,
    values: ANALYTICS_PERIOD,
    fallback: ANALYTICS_PERIOD.THIS_MONTH,
    code: "ANALYTICS_PERIOD_INVALID",
    label: "Analytics period"
  });
  const today = datePartsInTimeZone(now, timeZone);
  const todayStart = startOfLocalDay(today, timeZone);
  const monthStart = startOfLocalMonth(today, timeZone);
  const quarterStart = startOfLocalQuarter(today, timeZone);
  const yearStart = startOfLocalYear(today, timeZone);

  if (normalizedPeriod === ANALYTICS_PERIOD.CUSTOM) {
    return resolveCustomRange({ period: normalizedPeriod, from, to, timeZone, label: "Custom" });
  }

  if (normalizedPeriod === ANALYTICS_PERIOD.MULTI_YEAR) {
    if (!from || !to) {
      throw new AppError("Multi-year analytics requires explicit from and to dates", 422, "ANALYTICS_MULTI_YEAR_RANGE_REQUIRED");
    }
    return resolveCustomRange({ period: normalizedPeriod, from, to, timeZone, label: "Multi-year" });
  }

  if (normalizedPeriod === ANALYTICS_PERIOD.LIFETIME) {
    return buildRange({
      period: normalizedPeriod,
      timeZone,
      label: "Lifetime",
      warnings: ["LIFETIME_PERIOD_IS_UNBOUNDED"]
    });
  }

  const currentMonthParts = { year: today.year, month: today.month, day: 1 };
  const currentQuarterParts = { year: today.year, month: Math.floor((today.month - 1) / 3) * 3 + 1, day: 1 };
  const currentYearParts = { year: today.year, month: 1, day: 1 };

  const rangeByPeriod = {
    [ANALYTICS_PERIOD.TODAY]: () => ({
      from: todayStart,
      to: startOfLocalDay(addDays(today, 1), timeZone),
      label: "Today"
    }),
    [ANALYTICS_PERIOD.YESTERDAY]: () => ({
      from: startOfLocalDay(addDays(today, -1), timeZone),
      to: todayStart,
      label: "Yesterday"
    }),
    [ANALYTICS_PERIOD.THIS_WEEK]: () => ({
      from: startOfLocalWeek(today, timeZone),
      to: startOfLocalDay(addDays(datePartsInTimeZone(startOfLocalWeek(today, timeZone), timeZone), 7), timeZone),
      label: "This week"
    }),
    [ANALYTICS_PERIOD.LAST_WEEK]: () => {
      const thisWeekStart = startOfLocalWeek(today, timeZone);
      const thisWeekParts = datePartsInTimeZone(thisWeekStart, timeZone);
      return {
        from: startOfLocalDay(addDays(thisWeekParts, -7), timeZone),
        to: thisWeekStart,
        label: "Last week"
      };
    },
    [ANALYTICS_PERIOD.THIS_MONTH]: () => ({
      from: monthStart,
      to: startOfLocalMonth(addMonths(currentMonthParts, 1), timeZone),
      label: "This month"
    }),
    [ANALYTICS_PERIOD.LAST_MONTH]: () => ({
      from: startOfLocalMonth(addMonths(currentMonthParts, -1), timeZone),
      to: monthStart,
      label: "Last month"
    }),
    [ANALYTICS_PERIOD.THIS_QUARTER]: () => ({
      from: quarterStart,
      to: startOfLocalQuarter(addMonths(currentQuarterParts, 3), timeZone),
      label: "This quarter"
    }),
    [ANALYTICS_PERIOD.LAST_QUARTER]: () => ({
      from: startOfLocalQuarter(addMonths(currentQuarterParts, -3), timeZone),
      to: quarterStart,
      label: "Last quarter"
    }),
    [ANALYTICS_PERIOD.THIS_YEAR]: () => ({
      from: yearStart,
      to: startOfLocalYear(addMonths(currentYearParts, 12), timeZone),
      label: "This year"
    }),
    [ANALYTICS_PERIOD.LAST_YEAR]: () => ({
      from: startOfLocalYear(addMonths(currentYearParts, -12), timeZone),
      to: yearStart,
      label: "Last year"
    })
  };

  const resolved = rangeByPeriod[normalizedPeriod]();
  return buildRange({ period: normalizedPeriod, timeZone, ...resolved });
};

const previousCalendarRange = ({ currentRange, unit, timeZone = ANALYTICS_TIME_ZONE }) => {
  if (!currentRange?.from) {
    throw new AppError("Comparison requires a bounded current period", 422, "ANALYTICS_COMPARISON_REQUIRES_BOUNDARY");
  }
  const startParts = datePartsInTimeZone(currentRange.from, timeZone);
  if (unit === "MONTH") {
    const monthStart = startOfLocalMonth(startParts, timeZone);
    return {
      from: startOfLocalMonth(addMonths({ year: startParts.year, month: startParts.month, day: 1 }, -1), timeZone),
      to: monthStart
    };
  }
  if (unit === "QUARTER") {
    const quarterMonth = Math.floor((startParts.month - 1) / 3) * 3 + 1;
    const quarterStart = startOfLocalQuarter({ year: startParts.year, month: quarterMonth, day: 1 }, timeZone);
    return {
      from: startOfLocalQuarter(addMonths({ year: startParts.year, month: quarterMonth, day: 1 }, -3), timeZone),
      to: quarterStart
    };
  }
  const yearStart = startOfLocalYear(startParts, timeZone);
  return {
    from: startOfLocalYear({ year: startParts.year - 1, month: 1, day: 1 }, timeZone),
    to: yearStart
  };
};

const resolveComparisonPeriod = ({
  currentRange,
  compare = ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
  compareFrom = "",
  compareTo = "",
  timeZone = currentRange?.timeZone || ANALYTICS_TIME_ZONE
} = {}) => {
  const mode = assertKnown({
    value: compare,
    values: ANALYTICS_COMPARE_MODE,
    fallback: ANALYTICS_COMPARE_MODE.NONE,
    code: "ANALYTICS_COMPARE_MODE_INVALID",
    label: "Analytics comparison mode"
  });

  if (mode === ANALYTICS_COMPARE_MODE.NONE) return null;

  if (mode === ANALYTICS_COMPARE_MODE.CUSTOM) {
    return {
      mode,
      range: resolveCustomRange({ period: ANALYTICS_PERIOD.CUSTOM, from: compareFrom, to: compareTo, timeZone, label: "Custom comparison" })
    };
  }

  if (!currentRange?.from || !currentRange?.to) {
    return {
      mode,
      range: null,
      disabled: true,
      reason: "UNBOUNDED_CURRENT_PERIOD"
    };
  }

  if (mode === ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD) {
    const duration = currentRange.to.getTime() - currentRange.from.getTime();
    return {
      mode,
      range: buildRange({
        period: ANALYTICS_PERIOD.CUSTOM,
        timeZone,
        label: "Previous period",
        from: new Date(currentRange.from.getTime() - duration),
        to: new Date(currentRange.from.getTime())
      })
    };
  }

  const unitByMode = {
    [ANALYTICS_COMPARE_MODE.PREVIOUS_MONTH]: "MONTH",
    [ANALYTICS_COMPARE_MODE.PREVIOUS_QUARTER]: "QUARTER",
    [ANALYTICS_COMPARE_MODE.PREVIOUS_YEAR]: "YEAR"
  };
  const previous = previousCalendarRange({ currentRange, unit: unitByMode[mode], timeZone });
  return {
    mode,
    range: buildRange({
      period: ANALYTICS_PERIOD.CUSTOM,
      timeZone,
      label: mode.replace(/_/g, " ").toLowerCase(),
      from: previous.from,
      to: previous.to
    })
  };
};

const safePercentageChange = (currentValue = 0, previousValue = 0, decimalPlaces = 1) => {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const absoluteDifference = Number((current - previous).toFixed(2));

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      current,
      previous,
      absoluteDifference,
      percentageChange: null,
      comparisonValid: false,
      reason: "NON_FINITE_VALUE"
    };
  }

  if (previous === 0) {
    return {
      current,
      previous,
      absoluteDifference,
      percentageChange: null,
      comparisonValid: false,
      reason: "ZERO_PREVIOUS_VALUE"
    };
  }

  return {
    current,
    previous,
    absoluteDifference,
    percentageChange: Number((((current - previous) / Math.abs(previous)) * 100).toFixed(decimalPlaces)),
    comparisonValid: true,
    reason: ""
  };
};

module.exports = {
  datePartsInTimeZone,
  parseAnalyticsDate,
  resolveAnalyticsPeriod,
  resolveComparisonPeriod,
  safePercentageChange,
  zonedDateTimeToUtc,
  __testables: {
    addDays,
    addMonths,
    startOfLocalDay,
    startOfLocalMonth,
    startOfLocalQuarter,
    startOfLocalWeek,
    startOfLocalYear,
    timeZoneOffsetMs
  }
};

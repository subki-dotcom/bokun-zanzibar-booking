const BOOKING_SESSION_KEY = "zanzibar_booking_session_v2";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();

const safeJsonParse = (raw = "") => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveBookingSession = (session = {}) => {
  const payload = {
    ...session,
    updatedAt: nowIso()
  };

  try {
    sessionStorage.setItem(BOOKING_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write errors.
  }

  return payload;
};

export const readBookingSession = () => {
  try {
    const parsed = safeJsonParse(sessionStorage.getItem(BOOKING_SESSION_KEY));
    if (!parsed) {
      return null;
    }

    const updatedAt = new Date(parsed.updatedAt || 0).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(BOOKING_SESSION_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const clearBookingSession = () => {
  try {
    sessionStorage.removeItem(BOOKING_SESSION_KEY);
  } catch {
    // Ignore storage delete errors.
  }
};

export const hasCompleteTripDetails = (session = null, expectedSlug = "") => {
  if (!session || typeof session !== "object") {
    return false;
  }

  const productSlug = String(session?.product?.slug || "").trim();
  if (expectedSlug && productSlug && productSlug !== String(expectedSlug).trim()) {
    return false;
  }

  const optionId = String(session?.tripDetails?.optionId || "").trim();
  const rateId = String(session?.tripDetails?.rateId || "").trim();
  const travelDate = String(session?.tripDetails?.travelDate || "").trim();
  const passengers = Array.isArray(session?.tripDetails?.passengers)
    ? session.tripDetails.passengers
    : [];

  const hasPassengers = passengers.some((row) => Number(row?.quantity || 0) > 0);

  return Boolean(optionId && rateId && travelDate && hasPassengers);
};


// Pure helpers for the payment pages (mockups "Pay", "PayIssue", "Confirmed"): which screen a payment state shows,
// and the trip line. Built only from the booking's payment status.
import { formatTripDate, travellersText } from "../checkout/checkoutData.js";

// pay | processing | problem | confirmed | cancelled, from the backend status and whether a provider page is open.
export const screenFor = (data = null) => {
  if (!data) return "loading";
  if (data.status === "paid") return "confirmed";
  if (data.status === "cancelled") return "cancelled";
  if (data.status === "processing") return "processing";
  if (data.status === "awaiting_payment" && data.session?.redirectUrl) return "pay";
  return "problem";
};

// The problem screen's reason: expired | failed | load_error | unavailable | date_passed.
export const problemKind = (data = null, loadError = false) => {
  if (data?.trip && data.trip.bookable === false) return data.trip.reason === "date_passed" ? "date_passed" : "unavailable";
  if (loadError) return "load_error";
  if (data?.status === "failed") return "failed";
  return "expired";
};

export const PROBLEM_COPY = {
  expired: {
    title: "Your payment session has expired",
    why: "Payment links expire for your security after some time, or if the page was refreshed or opened on another device."
  },
  failed: {
    title: "Your payment didn't go through",
    why: "The payment provider did not confirm a payment. This can happen if the payment was cancelled, declined by your bank or interrupted."
  },
  load_error: {
    title: "We couldn't load the payment page",
    why: "The secure payment page did not open. This is usually a slow connection or a browser setting blocking it."
  },
  unavailable: {
    title: "This time is no longer available",
    why: "The start time you chose sold out while your payment was waiting. Choose a new date or time to book again."
  },
  date_passed: {
    title: "This tour date has passed",
    why: "The date of this booking is in the past, so it can no longer be paid. Choose a new date to book again."
  }
};

// "Tue, 10 Nov 2026 · 07:00 · 2 adults"
export const tripLine = (data = {}) =>
  [formatTripDate(data.date || ""), data.time || "", travellersText(data.travelers || {})].filter(Boolean).join(" · ");

export const paymentPageHref = ({ reference = "", key = "" } = {}) => {
  const query = new URLSearchParams();
  if (key) query.set("checkoutKey", key);
  if (reference) query.set("bookingReference", reference);
  return `/payment-processing?${query.toString()}`;
};

export const confirmedHref = ({ reference = "", key = "" } = {}) =>
  `/booking/confirmed/${encodeURIComponent(reference)}${key ? `?key=${encodeURIComponent(key)}` : ""}`;

export const whatsappReferenceHref = (baseHref = "", reference = "", title = "") => {
  if (!baseHref) return "";
  const text = `Hi, I need help with my booking ${reference}${title ? ` (${title})` : ""}.`;
  return `${baseHref}?text=${encodeURIComponent(text)}`;
};

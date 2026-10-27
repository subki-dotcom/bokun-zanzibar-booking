// Pure helpers for the payment pages (mockups "Pay", "PayIssue", "Confirmed"): which screen a payment state shows,
// and the trip line. Built only from the booking's payment status.
import { formatTripDate, travellersText } from "../checkout/checkoutData.js";
import { BRAND } from "../../config/brand.js";

// pay | processing | problem | confirmed | cancelled, from the backend status and whether a provider page is open.
export const screenFor = (data = null) => {
  if (!data) return "loading";
  if (data.status === "paid") return "confirmed";
  if (data.status === "cancelled") return "cancelled";
  if (data.status === "processing") return "processing";
  // A past date or a sold-out time is never paid for, even with an open payment page.
  if (data.trip && data.trip.bookable === false) return "problem";
  if (data.status === "awaiting_payment" && data.session?.redirectUrl) return "pay";
  return "problem";
};

// The problem screen's reason: expired | failed | load_error | unavailable | date_passed | still_processing | cancelled.
export const problemKind = (data = null, loadError = false, stillProcessing = false) => {
  if (data?.status === "cancelled") return "cancelled";
  if (stillProcessing || data?.status === "processing") return "still_processing";
  if (data?.trip && data.trip.bookable === false) return data.trip.reason === "date_passed" ? "date_passed" : "unavailable";
  if (loadError) return "load_error";
  if (data?.status === "failed") return "failed";
  return "expired";
};

// lead: the reassurance (its bold part separately); action: what the primary button does.
export const PROBLEM_COPY = {
  expired: {
    title: "Your payment session has expired",
    lead: ["Don't worry – your booking details are saved and ", "no money has been taken", ". Continue below to finish paying."],
    action: "pay",
    why: "Payment links expire for your security after some time, or if the page was refreshed or opened on another device."
  },
  failed: {
    title: "Your payment didn't go through",
    // Shown only after the provider re-check: a failed payment there means nothing was charged.
    lead: ["Don't worry – your booking details are saved and ", "your card was not charged", ". You can try again below."],
    action: "pay",
    why: "The payment provider did not confirm a payment. This can happen if the payment was cancelled, declined by your bank or interrupted."
  },
  load_error: {
    title: "We couldn't load the payment page",
    lead: ["Don't worry – your booking details are saved and ", "no money has been taken", ". Continue below to open it again."],
    action: "pay",
    why: "The secure payment page did not open. This is usually a slow connection or a browser setting blocking it."
  },
  unavailable: {
    title: "This time is no longer available",
    lead: ["", "No money has been taken", " for this booking. Choose a new date or time to book again."],
    action: "new_date",
    why: "The start time you chose sold out while your payment was waiting. Choose a new date or time to book again."
  },
  date_passed: {
    title: "This tour date has passed",
    lead: ["", "No money has been taken", " for this booking. Choose a new date to book again."],
    action: "new_date",
    why: "The date of this booking is in the past, so it can no longer be paid. Choose a new date to book again."
  },
  still_processing: {
    title: "We're still confirming your payment",
    lead: ["If you have already paid, ", "please don't pay again", " – your ticket is emailed as soon as the payment provider confirms it."],
    action: "check",
    why: "Some payments, especially mobile money, take a few minutes to be confirmed by the payment provider."
  },
  cancelled: {
    title: "This booking is no longer active",
    lead: ["", "No payment is due", " for this booking. You can book the tour again for a new date."],
    action: "new_date",
    why: "The booking was cancelled, so it can no longer be paid."
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

// Hours from "8 hours", "30 minutes", "2 days" (4 hours when unknown).
export const durationHours = (text = "") => {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(minute|min|hour|hr|h\b|day)/i);
  if (!match) return 4;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit.startsWith("min") ? value / 60 : unit.startsWith("day") ? value * 24 : value;
};

const ZANZIBAR_OFFSET_HOURS = 3;
const pad = (value) => String(value).padStart(2, "0");
const utcStamp = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;

// The tour as a calendar event: start in Zanzibar time (UTC+3), end after its duration.
export const calendarEvent = (data = {}) => {
  const day = String(data.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!day) return null;
  const [hours, minutes] = (String(data.time || "").match(/^(\d{1,2}):(\d{2})/) || [0, "8", "00"]).slice(1).map(Number);
  const start = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hours - ZANZIBAR_OFFSET_HOURS, minutes));
  const end = new Date(start.getTime() + durationHours(data.tour?.duration) * 3600 * 1000);
  return {
    title: data.tour?.title || "Zanzibar tour",
    start,
    end,
    location: data.pickupHotel || "Zanzibar",
    details: `Booking reference ${data.bookingReference || ""}${data.tour?.option ? ` · ${data.tour.option}` : ""}`
  };
};

const icsText = (value = "") => String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export const icsFile = (event, uid = "") =>
  event
    ? [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:-//${BRAND.name}//Booking//EN`,
        "BEGIN:VEVENT",
        `UID:${uid || utcStamp(event.start)}@zanzibartoursandsafaris.co.tz`,
        `DTSTAMP:${utcStamp(new Date())}`,
        `DTSTART:${utcStamp(event.start)}`,
        `DTEND:${utcStamp(event.end)}`,
        `SUMMARY:${icsText(event.title)}`,
        `LOCATION:${icsText(event.location)}`,
        `DESCRIPTION:${icsText(event.details)}`,
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n")
    : "";

export const googleCalendarHref = (event) =>
  event
    ? `https://calendar.google.com/calendar/render?${new URLSearchParams({
        action: "TEMPLATE",
        text: event.title,
        dates: `${utcStamp(event.start)}/${utcStamp(event.end)}`,
        location: event.location,
        details: event.details
      }).toString()}`
    : "";

// Pure helpers for the checkout page (mockup "Checkout"): formatting, the free-cancellation deadline, price lines,
// step summaries, payment choices and pickup search. Built only from real booking data.
import { cancellationDisplayText } from "../../utils/cancellationPolicy.js";

export const ZANZIBAR_TZ = "Africa/Dar_es_Salaam";
const ZANZIBAR_UTC_OFFSET_HOURS = 3; // East Africa Time, no daylight saving.

export const STEPS = [
  { id: "contact", title: "Contact details", next: "Next: Activity details" },
  { id: "activity", title: "Activity details", next: "Next: Payment" },
  { id: "payment", title: "Payment", next: "" }
];

export const formatMoney = (amount = 0, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(amount || 0));

const isoParts = (iso = "") => {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match.slice(1).map(Number) : null;
};

// "Tue, 10 Nov 2026" (or "Tue, 10 Nov" without the year) for a YYYY-MM-DD travel date.
export const formatTripDate = (iso = "", { year = true } = {}) => {
  const parts = isoParts(iso);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) })
    .format(date)
    .replace(/^(\w+)\s/, "$1, ");
};

// The tour start in Zanzibar time as a Date.
export const travelStart = (travelDate = "", startTime = "") => {
  const parts = isoParts(travelDate);
  if (!parts) return null;
  const [hours, minutes] = (String(startTime || "").match(/^(\d{1,2}):(\d{2})/) || [0, 0, 0]).slice(1).map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], hours - ZANZIBAR_UTC_OFFSET_HOURS, minutes));
};

const UNIT_HOURS = { minute: 1 / 60, minutes: 1 / 60, hour: 1, hours: 1, day: 24, days: 24, week: 168, weeks: 168 };

// Hours before the start that cancellation is still free, from the live policy or its text; 0 when there is none.
export const freeCancellationHours = (policy = null, policyText = "") => {
  const value = Number(policy?.freeCancellationCutoffValue);
  const unit = String(policy?.freeCancellationCutoffUnit || "hours").toLowerCase();
  if (Number.isFinite(value) && value > 0 && UNIT_HOURS[unit]) return value * UNIT_HOURS[unit];
  const text = cancellationDisplayText(policyText || policy?.policySummary || policy?.policyDescription || "");
  const match = text.match(/free cancellation[^.]*?until\s+(\d+)\s*(minutes?|hours?|days?|weeks?)\s+before/i);
  return match ? Number(match[1]) * UNIT_HOURS[match[2].toLowerCase()] : 0;
};

// When free cancellation ends, or null (non-refundable, unknown, or already passed). The quote's own deadline wins;
// otherwise the start minus the free-cancellation window. (The quote's `refundable` flag can be false while free
// cancellation is still available, so it is not used.)
export const freeCancellationDeadline = ({ travelDate = "", startTime = "", policy = null, policyText = "", now = new Date() } = {}) => {
  let deadline = policy?.deadline ? new Date(policy.deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) {
    const hours = freeCancellationHours(policy, policyText);
    const start = travelStart(travelDate, startTime);
    deadline = hours > 0 && start ? new Date(start.getTime() - hours * 3600 * 1000) : null;
  }
  return deadline && deadline.getTime() > now.getTime() ? deadline : null;
};

// "07:00 on Mon, 9 Nov 2026" in Zanzibar time.
export const formatDeadline = (date, { year = true } = {}) => {
  if (!date) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZANZIBAR_TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.hour}:${parts.minute} on ${parts.weekday}, ${parts.day} ${parts.month}${year ? ` ${parts.year}` : ""}`;
};

const pluralLabel = (label = "", quantity = 1) => {
  const word = String(label || "Traveler").trim().toLowerCase();
  if (quantity === 1) return word;
  if (/child$/.test(word)) return `${word}ren`;
  if (/(s|people|group)$/.test(word)) return word;
  return `${word}s`;
};

// "2 adults, 1 child" from the travellers' adults / children / infants.
export const travellersText = (pax = {}) =>
  [
    pax.adults ? `${pax.adults} ${pluralLabel("adult", pax.adults)}` : "",
    pax.children ? `${pax.children} ${pluralLabel("child", pax.children)}` : "",
    pax.infants ? `${pax.infants} ${pluralLabel("infant", pax.infants)}` : ""
  ]
    .filter(Boolean)
    .join(", ");

// Price lines from the live quote: "2 adults × $170.00" → $340.00, plus extras and discounts.
export const priceLines = (pricing = null) => {
  if (!pricing) return [];
  const currency = pricing.currency || "USD";
  const lines = (pricing.lineItems || [])
    .filter((item) => Number(item.quantity || 0) > 0 || Number(item.total || 0) > 0)
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const unit = Number(item.unitPrice ?? Number(item.total || 0) / quantity);
      return {
        label: `${quantity} ${pluralLabel(item.label, quantity)} × ${formatMoney(unit, currency)}`,
        amount: formatMoney(item.total, currency)
      };
    });
  if (Number(pricing.discountAmount) > 0) {
    lines.push({ label: pricing.offer?.name ? `Discount (${pricing.offer.name})` : "Discount", amount: `−${formatMoney(pricing.discountAmount, currency)}` });
  }
  return lines;
};

export const fullName = (form = {}) => [form.firstName, form.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const contactErrors = (form = {}, phone = { valid: false }) => {
  const errors = {};
  if (String(form.firstName || "").trim().length < 2) errors.firstName = "Enter your first name";
  if (String(form.lastName || "").trim().length < 2) errors.lastName = "Enter your last name";
  if (!String(form.email || "").trim()) errors.email = "Enter your email address";
  else if (!EMAIL_PATTERN.test(String(form.email).trim())) errors.email = "Enter a valid email, like you@example.com";
  if (!phone.valid) errors.phone = phone.message || "Enter a valid phone number";
  return errors;
};

export const pickupLabel = (place = {}) => [place.title, place.address].map((value) => String(value || "").trim()).filter(Boolean).join(", ");

// Hotels whose name or address contains every word of the search.
export const filterHotels = (places = [], query = "") => {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return places;
  return places.filter((place) => {
    const haystack = `${place.title || ""} ${place.address || ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};

export const HOTEL_NOT_LISTED = "My hotel isn't listed – I'll send it on WhatsApp";
// The hotel name sent when the guest will send it on WhatsApp (never the search text: the server matches names loosely).
export const HOTEL_TO_FOLLOW = "Hotel to be sent on WhatsApp";

// The notes sent with the booking: room, language choice, an unlisted hotel and the guest's own requests.
export const bookingNotes = (form = {}, { languageChoosable = false } = {}) =>
  [
    form.hotelNotListed ? `Hotel not listed – the guest will send it on WhatsApp${String(form.hotelTyped || "").trim() ? ` (typed: ${String(form.hotelTyped).trim()})` : ""}` : "",
    form.hotelNotListed && form.hotelName ? `Nearest listed hotel, used for the pickup: ${form.hotelName}` : "",
    String(form.roomNumber || "").trim() ? `Room: ${String(form.roomNumber).trim()}` : "",
    languageChoosable && form.language ? `Tour language: ${form.language}` : "",
    String(form.notes || "").trim()
  ]
    .filter(Boolean)
    .join("\n");

export const activitySummary = ({ hasPickup = true, hotel = "", hotelNotListed = false, meetingPoint = "", language = "" } = {}) =>
  [
    hasPickup ? `Pickup: ${hotelNotListed ? (hotel ? `near ${hotel} (hotel sent on WhatsApp)` : HOTEL_TO_FOLLOW) : hotel || "Not selected"}` : meetingPoint ? `Meeting point: ${meetingPoint}` : "",
    language
  ]
    .filter(Boolean)
    .join(" · ");

// Payment methods as the guest sees them, each paid through one of the enabled providers.
const PAYMENT_CHOICES = [
  {
    id: "card",
    providers: ["pesapal", "dpo"],
    title: "Credit or debit card",
    detail: "Visa, Mastercard – processed securely by Pesapal / DPO",
    badge: "VISA · MC",
    info: "You will enter your card details on the secure payment page in the next step. We never store your card number."
  },
  {
    id: "mobile",
    providers: ["pesapal"],
    title: "Mobile money",
    detail: "M-Pesa, Tigo Pesa, Airtel Money via Pesapal",
    badge: "M-PESA",
    info: "You will receive a payment prompt on your phone to approve the payment."
  },
  {
    id: "paypal",
    providers: ["paypal"],
    title: "PayPal",
    detail: "Pay with your PayPal account",
    badge: "PayPal",
    info: "You will be redirected to PayPal to complete payment, then back to your confirmation."
  }
];

// The choices whose provider is enabled, each with the provider that takes the payment.
export const paymentChoices = (enabledProviderIds = []) => {
  const enabled = new Set(enabledProviderIds);
  return PAYMENT_CHOICES.map((choice) => ({ ...choice, provider: choice.providers.find((id) => enabled.has(id)) || "" })).filter(
    (choice) => choice.provider
  );
};

// A WhatsApp link with the tour, date and option already written.
export const whatsappHelpHref = (baseHref = "", { title = "", date = "", option = "" } = {}) => {
  if (!baseHref) return "";
  const text = [`Hi, I need help booking ${title || "a tour"}`, date ? `on ${date}` : "", option ? `(${option})` : ""].filter(Boolean).join(" ");
  return `${baseHref}?text=${encodeURIComponent(`${text}.`)}`;
};

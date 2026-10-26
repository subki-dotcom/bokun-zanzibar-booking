// The guest "My booking" page data, built from a booking. Pure: no database or network. Personal data is masked,
// supplier codes and internal ids are left out. All times are Zanzibar time (UTC+3, no daylight saving).
const { maskEmail, maskName, maskPhone } = require("./core");

const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_REQUEST_STATUSES = new Set([
  "submitted",
  "under_review",
  "awaiting_customer_information",
  "awaiting_availability_check",
  "awaiting_additional_payment",
  "approved",
  "processing"
]);
const PAID = new Set(["paid", "overpaid"]);
const PROVIDER_LABELS = { pesapal: "Pesapal", dpo: "DPO", paypal: "PayPal", manual_bank_transfer: "Bank transfer", cash: "Cash" };

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const stripHtml = (value = "") =>
  text(value)
    .replace(/<br\s*\/?>|<\/(p|li)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();

// "2026-11-30" (Zanzibar calendar day of an instant)
const zanzibarDay = (ms) => new Date(ms + ZANZIBAR_OFFSET_MS).toISOString().slice(0, 10);

// The tour start as an instant, from its Zanzibar date and "HH:mm" (08:00 when the time is unknown).
const tripStartMs = (date = "", time = "") => {
  const day = text(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!day) return null;
  const [h, m] = (text(time).match(/^(\d{1,2}):(\d{2})/) || [null, "8", "0"]).slice(1).map(Number);
  return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), h, m) - ZANZIBAR_OFFSET_MS;
};

// "HH:mm" in Zanzibar time.
const zanzibarTime = (ms) => new Date(ms + ZANZIBAR_OFFSET_MS).toISOString().slice(11, 16);

// Hours from "8 hours", "45 minutes", "2 days"; null when unknown.
const durationHours = (value = "") => {
  const match = text(value).match(/(\d+(?:\.\d+)?)\s*(minute|min|hour|hr|h\b|day)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit.startsWith("min") ? amount / 60 : unit.startsWith("day") ? amount * 24 : amount;
};

const travelersLabel = ({ adults = 0, children = 0, infants = 0 } = {}) =>
  [
    [adults, "adult", "adults"],
    [children, "child", "children"],
    [infants, "infant", "infants"]
  ]
    .filter(([count]) => num(count) > 0)
    .map(([count, one, many]) => `${num(count)} ${num(count) === 1 ? one : many}`)
    .join(", ") || "—";

// When it is now relative to the trip: upcoming (with whole days to go), today or past (Zanzibar days).
const tripPhase = (date = "", now = Date.now()) => {
  const today = zanzibarDay(now);
  const day = text(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { phase: "unknown", daysToGo: null };
  if (day === today) return { phase: "today", daysToGo: 0 };
  if (day < today) return { phase: "past", daysToGo: null };
  return { phase: "upcoming", daysToGo: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) };
};

const activeRequests = (requests = []) => requests.filter((request) => ACTIVE_REQUEST_STATUSES.has(lower(request.status)));

// The status pill: never only a colour, always a label.
const bookingState = ({ booking = {}, requests = [], phase = "unknown" }) => {
  const status = lower(booking.bookingStatus);
  const payment = lower(booking.paymentStatus);
  const active = activeRequests(requests);
  if (status === "cancelled" || payment === "refunded") return { key: "cancelled", label: "Cancelled", tone: "danger" };
  if (active.some((request) => request.type === "cancel_booking")) return { key: "cancellation_requested", label: "Cancellation requested", tone: "warning" };
  if (active.length) return { key: "change_requested", label: "Change requested", tone: "warning" };
  if (!PAID.has(payment)) return { key: "pending_payment", label: "Pending payment", tone: "warning" };
  if (phase === "past") return { key: "completed", label: "Completed", tone: "neutral" };
  if (status === "confirmed" || lower(booking.supplierStatus) === "confirmed") return { key: "confirmed", label: "Confirmed · Paid in full", tone: "success" };
  return { key: "paid", label: "Paid · Confirming with the operator", tone: "success" };
};

// "Sun, 29 Nov, 09:00" for a policy deadline (an ISO string with offset).
const deadlineLabel = (iso = "") => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + ZANZIBAR_OFFSET_MS);
  const weekday = local.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const date = local.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${weekday}, ${date}, ${zanzibarTime(ms)}`;
};

const money = (amount = 0, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num(amount));
  } catch {
    return `${currency} ${num(amount).toFixed(2)}`;
  }
};

// The free-cancellation bar and what a cancellation would refund now.
const policyView = ({ policy = null, tripStart = null, now = Date.now(), currency = "USD" }) => {
  const deadline = Date.parse(policy?.deadline || "");
  const hasDeadline = Number.isFinite(deadline);
  const free = Boolean(policy?.isFreeCancellationAvailable);
  // How far along the bar "now" is, between the booking time and the trip (green until the deadline, red after).
  const span = tripStart && hasDeadline ? { deadlineAt: new Date(deadline).toISOString(), tripAt: new Date(tripStart).toISOString() } : null;
  let refundLine = "Our team reviews the refund under the tour's cancellation policy";
  if (policy?.refundable === false && !free) refundLine = "This booking is non-refundable";
  else if (free && hasDeadline) refundLine = `Full refund if cancelled before ${deadlineLabel(policy.deadline)}`;
  else if (policy?.estimatedRefundAmount !== null && policy?.estimatedRefundAmount !== undefined && !policy?.requiresManualReview)
    refundLine = num(policy.estimatedRefundAmount) > 0 ? `${money(policy.estimatedRefundAmount, currency)} back if cancelled now` : "No refund if cancelled now";
  return {
    freeCancellation: free,
    deadline: hasDeadline ? new Date(deadline).toISOString() : "",
    deadlineLabel: hasDeadline ? deadlineLabel(policy.deadline) : "",
    deadlinePassed: hasDeadline ? now > deadline : false,
    refundable: policy?.refundable !== false,
    requiresManualReview: Boolean(policy?.requiresManualReview),
    summary: text(policy?.policySummary || ""),
    refundLine,
    amountPaid: num(policy?.amountPaid),
    estimatedRefund: policy?.estimatedRefundAmount ?? null,
    cancellationFee: policy?.estimatedCancellationFee ?? null,
    span
  };
};

// Which actions are open, with the reason when one is not.
const actionsView = ({ state, policy, phase, tripStart, now, requests }) => {
  const active = activeRequests(requests);
  const closed = (reason) => ({ allowed: false, reason });
  const started = tripStart !== null && now >= tripStart;
  const blocked =
    state.key === "cancelled" ? "This booking is cancelled."
      : state.key === "completed" || phase === "past" ? "This trip has already taken place."
      : state.key === "pending_payment" ? "Available once your payment is confirmed."
      : state.key === "cancellation_requested" ? "Your cancellation request is being reviewed."
      : started ? "Your trip has started – message us on WhatsApp for help."
      : "";
  const changeClosed = policy.deadlinePassed ? `Changes closed on ${policy.deadlineLabel} – message us on WhatsApp.` : "";
  const pending = (type) => (active.some((request) => request.type === type) ? "Request sent – we'll email you our answer." : "");
  return {
    changeDate: blocked ? closed(blocked) : pending("reschedule") ? closed(pending("reschedule")) : changeClosed ? closed(changeClosed) : { allowed: true, reason: "" },
    changeTravelers: blocked ? closed(blocked) : pending("change_travelers") ? closed(pending("change_travelers")) : changeClosed ? closed(changeClosed) : { allowed: true, reason: "" },
    cancel: blocked ? closed(blocked) : { allowed: true, reason: "" },
    changePickup: blocked ? closed(blocked) : changeClosed ? closed(changeClosed) : { allowed: true, reason: "" }
  };
};

const pickupView = ({ booking = {}, product = null, option = null, startTime = "" }) => {
  const hotel = text(booking.customer?.hotelName || booking.invoiceSnapshot?.pickupLocation);
  const pickupSupported = option ? option.pickupSupported !== false : Boolean(hotel);
  const place = (product?.pickupPlaces || []).find((item) => text(item.id) && text(item.id) === text(booking.customer?.pickupPlaceId));
  const lat = Number(place?.latitude);
  const lng = Number(place?.longitude);
  const coordinates = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
  if (pickupSupported && hotel) {
    const address = text(place?.address) || [text(place?.groupTitle), "Zanzibar"].filter(Boolean).join(", ");
    const query = coordinates ? `${coordinates.lat},${coordinates.lng}` : `${hotel}, Zanzibar`;
    return {
      type: "pickup",
      name: hotel,
      address: address || "Zanzibar",
      instruction: startTime ? `Meet your driver at the hotel reception at ${startTime}.` : "Meet your driver at the hotel reception.",
      coordinates,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    };
  }
  const meeting = stripHtml(product?.meetingInfo || "");
  if (!meeting && !hotel) return null;
  const [first, ...rest] = (meeting || hotel).split("\n").filter(Boolean);
  return {
    type: "meeting",
    name: first.slice(0, 120),
    address: rest.join(" ").slice(0, 240) || "Zanzibar",
    instruction: startTime ? `Please be at the meeting point by ${startTime}.` : "Please be at the meeting point on time.",
    coordinates,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${first}, Zanzibar`)}`
  };
};

const timelineView = ({ date = "", startTime = "", tripStart = null, duration = null, pickup = null, option = "" }) => {
  if (!date) return [];
  const rows = [
    { key: "day_before", time: "day_before", title: "Day before · pickup confirmation", text: "Our team messages you on WhatsApp with the exact time, car and driver contact." }
  ];
  if (startTime && tripStart !== null) {
    if (pickup?.type === "pickup") {
      rows.push({ key: "ready", time: zanzibarTime(tripStart - 10 * 60 * 1000), title: "Be ready at your hotel reception", text: "Have your booking reference or e-ticket on your phone." });
      rows.push({ key: "start", time: startTime, title: "Pickup", text: "Your driver meets you at reception.", highlight: true });
    } else {
      rows.push({ key: "ready", time: zanzibarTime(tripStart - 10 * 60 * 1000), title: "Arrive at the meeting point", text: "Have your booking reference or e-ticket on your phone." });
      rows.push({ key: "start", time: startTime, title: "Tour starts", text: "Your guide meets you at the meeting point.", highlight: true });
    }
    if (duration) {
      const end = tripStart + duration * 60 * 60 * 1000;
      // Only on the same day; multi-day trips show their end on the ticket instead.
      if (zanzibarDay(end) === zanzibarDay(tripStart)) {
        rows.push(
          pickup?.type === "pickup"
            ? { key: "end", time: zanzibarTime(end), title: "Drop-off at your destination", text: option ? `${option}.` : "Back at your hotel." }
            : { key: "end", time: zanzibarTime(end), title: "Tour ends", text: option ? `${option}.` : "End of the experience." }
        );
      }
    }
  }
  return rows;
};

const buildDashboard = ({
  booking = {},
  product = null,
  requests = [],
  policy = null,
  payment = null,
  invoiceAvailable = false,
  payHref = "",
  csrfToken = "",
  sessionEmail = "",
  now = Date.now()
}) => {
  const option = (product?.options || []).find((item) => text(item.bokunOptionId) === text(booking.bokunOptionId)) || null;
  const date = text(booking.travelDate).slice(0, 10);
  const clock = text(booking.startTime).match(/^(\d{1,2}):(\d{2})/);
  const startTime = clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : "";
  const tripStart = tripStartMs(date, startTime || "");
  const { phase, daysToGo } = tripPhase(date, now);
  const state = bookingState({ booking, requests, phase });
  const currency = text(booking.transactionCurrency || booking.currency || booking.pricingSnapshot?.currency || "USD").toUpperCase();
  const pax = booking.paxSummary || {};
  const travelers = { adults: num(pax.adults), children: num(pax.children), infants: num(pax.infants) };
  const optionTitle = text(booking.optionTitle || option?.name).replace(/^\s*w\/\s*/i, "");
  const policyData = policyView({ policy, tripStart: startTime ? tripStart : null, now, currency });
  const pickup = pickupView({ booking, product, option, startTime });
  const total = num(booking.pricingSnapshot?.finalPayable ?? booking.amount);
  const amountPaid = num(booking.invoiceSnapshot?.amountPaid ?? (PAID.has(lower(booking.paymentStatus)) ? total : 0));
  const amountRefunded = num(booking.invoiceSnapshot?.amountRefunded);
  const balanceDue = Math.max(0, num(booking.invoiceSnapshot?.balanceDue ?? total - amountPaid));
  const method = lower(payment?.provider || booking.paymentMethod);
  const cancelRequest = requests.find((request) => request.type === "cancel_booking") || null;

  return {
    reference: booking.bookingReference,
    status: state,
    tour: {
      title: text(booking.productTitle || product?.title),
      option: optionTitle,
      image: text(product?.images?.[0]),
      slug: text(product?.slug),
      duration: text(product?.duration)
    },
    date,
    startTime,
    timezoneLabel: "Zanzibar time",
    phase,
    daysToGo,
    travelers,
    travelersLabel: travelersLabel(travelers),
    lead: {
      name: maskName(booking.customer?.firstName, booking.customer?.lastName),
      email: maskEmail(booking.customer?.email),
      phone: maskPhone(booking.customer?.phone)
    },
    signedInAs: maskEmail(sessionEmail || booking.customer?.email),
    timeline: timelineView({ date, startTime, tripStart, duration: durationHours(product?.duration || option?.duration), pickup, option: optionTitle }),
    pickup,
    policy: policyData,
    actions: actionsView({ state, policy: policyData, phase, tripStart: startTime ? tripStart : null, now, requests }),
    requests: activeRequests(requests).map((request) => ({
      reference: request.requestReference,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt || null
    })),
    cancellation: cancelRequest
      ? {
          status: cancelRequest.status,
          refundStatus: cancelRequest.refund?.status || "",
          refundAmount: cancelRequest.refund?.approvedAmount ?? cancelRequest.refund?.eligibleAmount ?? null,
          refunded: num(cancelRequest.refund?.confirmedRefundedAmount || amountRefunded)
        }
      : null,
    receipt: {
      currency,
      lineItem: `${text(booking.productTitle || product?.title)} × ${travelersLabel(travelers)}`,
      total,
      taxes: "Included",
      amountPaid,
      amountRefunded,
      balanceDue,
      paid: amountPaid > 0,
      method: PROVIDER_LABELS[method] || "",
      paidAt: payment?.paidAt ? new Date(payment.paidAt).toISOString() : "",
      invoiceAvailable
    },
    payHref: balanceDue > 0 && state.key !== "cancelled" && phase !== "past" ? payHref : "",
    csrfToken
  };
};

module.exports = {
  buildDashboard,
  bookingState,
  tripPhase,
  tripStartMs,
  durationHours,
  travelersLabel,
  timelineView,
  policyView,
  actionsView,
  pickupView,
  deadlineLabel,
  zanzibarTime
};

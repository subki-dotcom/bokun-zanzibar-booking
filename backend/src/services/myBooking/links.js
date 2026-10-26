// One-time "My booking" sign-in links. Used by the lookup form and by every booking email.
const BookingAccessLink = require("../../models/BookingAccessLink");
const { env } = require("../../config/env");
const { LINK_TTL_MINUTES, hashSecret, normalizeEmail, randomSecret } = require("./core");

const publicSiteUrl = () =>
  String(env.PUBLIC_SITE_URL || String(env.FRONTEND_URL || "").split(",")[0] || "")
    .trim()
    .replace(/\/+$/, "");

// The lookup form for a reference (where an expired or used link sends the guest).
const lookupUrl = (reference = "") =>
  `${publicSiteUrl()}/my-booking${reference ? `?ref=${encodeURIComponent(reference)}` : ""}`;

// The token is in the URL fragment, so it never reaches server logs, proxies or Referer headers, and a mail
// scanner that opens the link does not use it up (the page posts it).
const accessUrl = (token = "") => `${publicSiteUrl()}/my-booking/open#token=${encodeURIComponent(token)}`;

const issueAccessLink = async ({ booking, purpose = "lookup", requestIp = "", now = new Date() }) => {
  const token = randomSecret(32);
  await BookingAccessLink.create({
    tokenHash: hashSecret(token),
    booking: booking._id,
    bookingReference: booking.bookingReference,
    email: normalizeEmail(booking.customer?.email),
    purpose,
    expiresAt: new Date(now.getTime() + LINK_TTL_MINUTES * 60 * 1000),
    requestIp
  });
  return { token, url: accessUrl(token) };
};

// A fresh link for a booking email, or the lookup form when one cannot be made.
const emailAccessUrl = async (booking) => {
  try {
    if (!booking?._id || !booking?.customer?.email) return lookupUrl(booking?.bookingReference);
    return (await issueAccessLink({ booking, purpose: "email" })).url;
  } catch {
    return lookupUrl(booking?.bookingReference);
  }
};

module.exports = { publicSiteUrl, lookupUrl, accessUrl, issueAccessLink, emailAccessUrl };

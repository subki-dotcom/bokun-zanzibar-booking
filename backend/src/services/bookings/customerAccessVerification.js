const crypto = require("node:crypto");
const AppError = require("../../utils/AppError");
const { emailMatches, issueBookingAccessToken } = require("../../security/bookingAccess");

// Recovery for customers without a valid access link. Knowing a booking reference and its email is
// not enough: a single-use, short-lived link is emailed to the address stored on the booking, and
// only following that link yields an access token.
const REQUEST_MESSAGE =
  "If the booking reference and email match our records, we have sent a secure link to the email address on the booking. The link expires in 20 minutes and works once.";
const CHALLENGE_TTL_MS = 20 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SECRET_PATTERN = /^[a-f0-9]{64}$/;

const hashSecret = (secret) => crypto.createHash("sha256").update(secret).digest("hex");
const invalidVerification = () =>
  new AppError(
    "This verification link is invalid, expired or already used. Request a new link.",
    400,
    "BOOKING_VERIFICATION_INVALID"
  );
const unavailable = () =>
  new AppError("Booking verification is temporarily unavailable. Please contact support.", 503, "BOOKING_VERIFICATION_UNAVAILABLE");

// The email is sent after the response so its delivery time cannot reveal whether details matched.
const inBackground = (task) => {
  setImmediate(() => {
    task().catch(() => {});
  });
};

const createCustomerAccessVerification = ({
  Booking,
  sendEmail,
  configured,
  siteOrigin,
  logFailure = () => {},
  now = () => new Date(),
  runInBackground = inBackground
}) => {
  const requestAccessLink = async ({ bookingReference, email }) => {
    const origin = typeof siteOrigin === "function" ? siteOrigin() : siteOrigin;
    if (!(typeof configured === "function" ? configured() : configured) || !origin) throw unavailable();

    const reference = String(bookingReference || "").trim();
    if (!REFERENCE_PATTERN.test(reference)) return { message: REQUEST_MESSAGE };
    const booking = await Booking.findOne({ bookingReference: reference }).select("_id bookingReference customer.email").lean();
    if (!booking || !emailMatches(email, booking.customer?.email)) return { message: REQUEST_MESSAGE };

    const secret = crypto.randomBytes(32).toString("hex");
    const secretHash = hashSecret(secret);
    const requestedAt = now();
    // Issuing replaces any earlier link; the cooldown stops a burst of requests mailing the customer.
    const issued = await Booking.updateOne(
      {
        _id: booking._id,
        $or: [
          { customerAccessChallengeRequestedAt: { $exists: false } },
          { customerAccessChallengeRequestedAt: null },
          { customerAccessChallengeRequestedAt: { $lt: new Date(requestedAt.getTime() - RESEND_COOLDOWN_MS) } }
        ]
      },
      {
        $set: {
          customerAccessChallengeHash: secretHash,
          customerAccessChallengeExpiresAt: new Date(requestedAt.getTime() + CHALLENGE_TTL_MS),
          customerAccessChallengeRequestedAt: requestedAt
        }
      }
    );

    if (issued.modifiedCount === 1) {
      const verifyUrl = `${origin}/my-booking/${encodeURIComponent(booking.bookingReference)}#verify=${secret}`;
      runInBackground(async () => {
        try {
          await sendEmail({ to: booking.customer.email, bookingReference: booking.bookingReference, verifyUrl });
        } catch {
          await Booking.updateOne(
            { _id: booking._id, customerAccessChallengeHash: secretHash },
            { $unset: { customerAccessChallengeHash: 1, customerAccessChallengeExpiresAt: 1 } }
          );
          // Never log provider errors: they can contain the email body and the link.
          logFailure();
        }
      });
    }
    return { message: REQUEST_MESSAGE };
  };

  const redeemAccessLink = async ({ bookingReference, secret }) => {
    const reference = String(bookingReference || "").trim();
    if (!REFERENCE_PATTERN.test(reference) || !SECRET_PATTERN.test(String(secret || ""))) throw invalidVerification();
    // One atomic update matches and consumes the link, so a replay or a concurrent second
    // redemption finds nothing.
    const booking = await Booking.findOneAndUpdate(
      {
        bookingReference: reference,
        customerAccessChallengeHash: hashSecret(secret),
        customerAccessChallengeExpiresAt: { $gt: now() }
      },
      { $unset: { customerAccessChallengeHash: 1, customerAccessChallengeExpiresAt: 1 } },
      { new: true }
    )
      .select("_id bookingReference customerAccessVersion")
      .lean();
    if (!booking) throw invalidVerification();
    const access = issueBookingAccessToken(booking);
    return { bookingReference: booking.bookingReference, accessToken: access.token, expiresAt: access.expiresAt };
  };

  return { requestAccessLink, redeemAccessLink };
};

module.exports = { createCustomerAccessVerification, REQUEST_MESSAGE, CHALLENGE_TTL_MS, RESEND_COOLDOWN_MS };

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const AppError = require("../../utils/AppError");

const REQUEST_MESSAGE = "If an active admin or staff account matches that email, a reset link will be sent. Check your inbox and spam folder.";
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const invalidLink = () => new AppError("This reset link is invalid or expired. Please request a new link.", 400, "RESET_LINK_INVALID");

// Dependencies allow recovery tests to run without contacting production or email providers.
const createPasswordRecovery = ({ User, sendEmail, configured, siteUrl, logFailure = () => {}, now = () => new Date() }) => {
  const requestReset = async ({ email }) => {
    let origin;
    try {
      origin = new URL(siteUrl);
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid origin");
    } catch {
      throw new AppError("Password recovery is temporarily unavailable. Please contact support.", 503, "RECOVERY_UNAVAILABLE");
    }
    if (!configured) throw new AppError("Password recovery is temporarily unavailable. Please contact support.", 503, "RECOVERY_UNAVAILABLE");

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const requestedAt = now();
    const account = await User.findOneAndUpdate({
      email: email.trim().toLowerCase(), isActive: true,
      role: { $in: ["super_admin", "admin", "staff"] },
      $or: [
        { passwordResetRequestedAt: { $exists: false } },
        { passwordResetRequestedAt: { $lt: new Date(requestedAt.getTime() - 60000) } }
      ]
    }, { $set: {
      passwordResetHash: tokenHash,
      passwordResetExpiresAt: new Date(requestedAt.getTime() + 30 * 60000),
      passwordResetRequestedAt: requestedAt
    } }, { new: true }).select("email").lean();

    if (account) {
      try {
        // Fragment keeps the credential out of HTTP access logs and referrer URLs.
        await sendEmail({ to: account.email, resetUrl: `${origin.origin}/reset-password#token=${token}` });
      } catch {
        await User.updateOne({ _id: account._id, passwordResetHash: tokenHash }, {
          $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 }
        });
        // Never log provider errors: they may contain the email body and reset credential.
        logFailure();
      }
    }
    return { message: REQUEST_MESSAGE };
  };

  const resetPassword = async ({ token, password }) => {
    if (!/^[a-f0-9]{64}$/.test(token || "")) throw invalidLink();
    if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      throw new AppError("Use at least 12 characters and no more than 72 UTF-8 bytes.", 422, "PASSWORD_INVALID");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    // One atomic update consumes the token and invalidates all previously issued sessions.
    const result = await User.updateOne({
      passwordResetHash: hashToken(token), passwordResetExpiresAt: { $gt: now() },
      isActive: true, role: { $in: ["super_admin", "admin", "staff"] }
    }, {
      $set: { password: passwordHash },
      $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 },
      $inc: { tokenVersion: 1 }
    });
    if (result.modifiedCount !== 1) throw invalidLink();
    return { message: "Your password has been changed. Sign in with your new password." };
  };
  return { requestReset, resetPassword };
};

module.exports = { createPasswordRecovery };

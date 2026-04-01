const crypto = require("crypto");
const dayjs = require("dayjs");
const { env } = require("../config/env");

const signQuoteToken = (payload) => {
  const expiresAt = dayjs().add(env.QUOTE_TTL_MINUTES, "minute").toISOString();
  const body = JSON.stringify({ ...payload, expiresAt });
  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("hex");

  return {
    token: Buffer.from(`${body}::${signature}`).toString("base64"),
    expiresAt
  };
};

const verifyQuoteToken = (token) => {
  if (!token) {
    return { valid: false, reason: "MISSING_TOKEN" };
  }

  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const [body, signature] = decoded.split("::");

    if (!body || !signature) {
      return { valid: false, reason: "INVALID_TOKEN_FORMAT" };
    }

    const expectedSignature = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== signature) {
      return { valid: false, reason: "INVALID_TOKEN_SIGNATURE" };
    }

    const parsed = JSON.parse(body);

    if (dayjs(parsed.expiresAt).isBefore(dayjs())) {
      return { valid: false, reason: "QUOTE_EXPIRED" };
    }

    return { valid: true, payload: parsed };
  } catch (error) {
    return { valid: false, reason: "TOKEN_PARSE_ERROR", details: error.message };
  }
};

module.exports = {
  signQuoteToken,
  verifyQuoteToken
};
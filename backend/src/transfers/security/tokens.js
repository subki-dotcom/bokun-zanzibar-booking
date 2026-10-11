const jwt = require("jsonwebtoken");

// Transfer Admin tokens are signed with their own secret and carry their own issuer and audience, so a
// Business Platform token can never be accepted here and a Transfer Admin token can never be accepted there.
const TOKEN_ISSUER = "riser-transfers";
const TOKEN_AUDIENCE = "riser-transfer-admin";
const TOKEN_TYPE = "transfer_admin";

const signTransferToken = (user, { secret, expiresIn }) =>
  jwt.sign({ typ: TOKEN_TYPE, role: user.role, tv: user.tokenVersion || 0 }, secret, {
    algorithm: "HS256",
    subject: String(user._id),
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn
  });

const verifyTransferToken = (token, { secret }) => {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE });
  if (payload.typ !== TOKEN_TYPE || !payload.sub) throw new Error("Not a Transfer Admin token");
  return payload;
};

module.exports = { TOKEN_ISSUER, TOKEN_AUDIENCE, signTransferToken, verifyTransferToken };

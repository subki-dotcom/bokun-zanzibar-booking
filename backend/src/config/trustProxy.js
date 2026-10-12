// Express "trust proxy" from TRUST_PROXY. It decides which X-Forwarded-For entries become req.ip,
// which every rate limit uses. Accepted values:
//   a hop count ("1" = exactly one proxy in front, the deployed default), "false"/"0" (no proxy:
//   forwarded headers ignored), or a comma list of proxy addresses/CIDRs/Express names
//   ("loopback, 10.0.0.0/8").
// "true" trusts every hop, letting any client choose its own address, so it is refused.
const parseTrustProxy = (value) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return 1;
  if (/^(false|off|no)$/i.test(raw)) return false;
  if (/^true$/i.test(raw)) {
    throw new Error("TRUST_PROXY=true would trust client-supplied X-Forwarded-For headers. Use a hop count or proxy addresses.");
  }
  if (/^\d+$/.test(raw)) return Number(raw) === 0 ? false : Number(raw);
  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return 1;
  return entries;
};

module.exports = { parseTrustProxy };

const crypto = require("crypto");

const escapeXml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const decodeXmlEntities = (value = "") =>
  String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const getTagValue = (xml = "", tag = "") => {
  if (!xml || !tag) {
    return "";
  }

  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = String(xml).match(pattern);
  return match ? decodeXmlEntities(match[1]).trim() : "";
};

const toMoneyAmount = (value = 0) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }

  return numeric.toFixed(2);
};

const toDpoServiceDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return toDpoServiceDateTime(new Date());
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
};

const buildCreateTokenXml = ({
  companyToken,
  serviceType,
  amount,
  currency,
  bookingReference,
  productTitle,
  customer = {},
  successUrl,
  cancelUrl,
  callbackUrl = "",
  transactionRef = "",
  timeoutSeconds = 1800
}) => {
  const safeRef = transactionRef || bookingReference || `REF-${Date.now()}`;
  const description = productTitle
    ? `${productTitle} booking`
    : `Tour booking ${bookingReference || ""}`.trim();

  return `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${escapeXml(toMoneyAmount(amount))}</PaymentAmount>
    <PaymentCurrency>${escapeXml(currency || "USD")}</PaymentCurrency>
    <CompanyRef>${escapeXml(safeRef)}</CompanyRef>
    <RedirectURL>${escapeXml(successUrl)}</RedirectURL>
    <BackURL>${escapeXml(cancelUrl)}</BackURL>
    <RedirectURLFailed>${escapeXml(cancelUrl)}</RedirectURLFailed>
    <CompanyRefUnique>1</CompanyRefUnique>
    <PTL>${escapeXml(String(timeoutSeconds || 1800))}</PTL>
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${escapeXml(serviceType)}</ServiceType>
      <ServiceDescription>${escapeXml(description)}</ServiceDescription>
      <ServiceDate>${escapeXml(toDpoServiceDateTime())}</ServiceDate>
    </Service>
  </Services>
  <CustomerFirstName>${escapeXml(customer.firstName || "")}</CustomerFirstName>
  <CustomerLastName>${escapeXml(customer.lastName || "")}</CustomerLastName>
  <CustomerPhone>${escapeXml(customer.phone || "")}</CustomerPhone>
  <CustomerEmail>${escapeXml(customer.email || "")}</CustomerEmail>
  <CustomerCountry>${escapeXml(customer.country || "TZ")}</CustomerCountry>
  ${callbackUrl ? `<ResultURL>${escapeXml(callbackUrl)}</ResultURL>` : ""}
</API3G>`;
};

const buildVerifyTokenXml = ({ companyToken, transactionToken }) => `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${escapeXml(transactionToken)}</TransactionToken>
</API3G>`;

const parseCreateTokenResponse = (xml = "") => ({
  resultCode: getTagValue(xml, "Result"),
  resultExplanation: getTagValue(xml, "ResultExplanation"),
  transactionToken:
    getTagValue(xml, "TransToken") ||
    getTagValue(xml, "TransactionToken") ||
    getTagValue(xml, "Token"),
  transactionRef:
    getTagValue(xml, "TransRef") ||
    getTagValue(xml, "TransactionRef") ||
    getTagValue(xml, "CompanyRef"),
  rawXml: xml
});

const parseVerifyTokenResponse = (xml = "") => {
  const rawStatus =
    getTagValue(xml, "TransactionStatus") ||
    getTagValue(xml, "Status") ||
    getTagValue(xml, "Result");

  return {
    resultCode: getTagValue(xml, "Result"),
    resultExplanation: getTagValue(xml, "ResultExplanation"),
    transactionToken:
      getTagValue(xml, "TransToken") ||
      getTagValue(xml, "TransactionToken") ||
      "",
    transactionRef:
      getTagValue(xml, "TransRef") ||
      getTagValue(xml, "TransactionRef") ||
      getTagValue(xml, "CompanyRef") ||
      "",
    transactionStatus: String(rawStatus || "").toUpperCase(),
    transactionAmount: Number(
      getTagValue(xml, "TransactionAmount") ||
        getTagValue(xml, "Amount") ||
        0
    ),
    transactionCurrency:
      getTagValue(xml, "TransactionCurrency") ||
      getTagValue(xml, "Currency") ||
      "",
    transactionDate:
      getTagValue(xml, "TransactionStatusDate") ||
      getTagValue(xml, "TransactionDate") ||
      "",
    rawXml: xml
  };
};

const isSuccessfulResultCode = (code = "") => {
  const normalized = String(code || "").trim();
  return normalized === "000" || normalized === "0" || normalized === "00";
};

const isPaidTransaction = (verification = {}) => {
  const status = String(verification.transactionStatus || "").toUpperCase();
  const paidStatuses = ["PAID", "COMPLETED", "COMPLETE", "APPROVED", "SUCCESSFUL"];

  if (paidStatuses.includes(status)) {
    return true;
  }

  return isSuccessfulResultCode(verification.resultCode);
};

const buildDpoPayUrl = (baseUrl, paymentPath, transactionToken) => {
  const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
  const normalizedPaymentPath = String(paymentPath || "/payv3.php").startsWith("/")
    ? String(paymentPath || "/payv3.php")
    : `/${String(paymentPath || "/payv3.php")}`;
  return `${normalizedBase}${normalizedPaymentPath}?ID=${encodeURIComponent(transactionToken)}`;
};

const buildDpoRequestId = (bookingReference = "") => {
  const seed = `${bookingReference}-${Date.now()}-${Math.random()}`;
  return `dpo_${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
};

const normalizeServiceType = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const numericMatch = raw.match(/\d{2,}/);
  return numericMatch ? numericMatch[0] : raw;
};

const isPrivateIpv4Host = (host = "") => {
  const token = String(host || "").trim();
  if (!token) {
    return false;
  }

  const octets = token.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;

  return false;
};

const isLocalOrPrivateRedirectUrl = (value = "") => {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = String(parsed.hostname || "").toLowerCase();

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }

    if (!host) {
      return true;
    }

    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return true;
    }

    if (isPrivateIpv4Host(host)) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
};

module.exports = {
  buildCreateTokenXml,
  buildVerifyTokenXml,
  parseCreateTokenResponse,
  parseVerifyTokenResponse,
  isSuccessfulResultCode,
  isPaidTransaction,
  buildDpoPayUrl,
  buildDpoRequestId,
  normalizeServiceType,
  isLocalOrPrivateRedirectUrl
};

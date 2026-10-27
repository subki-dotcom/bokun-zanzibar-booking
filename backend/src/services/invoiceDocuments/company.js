// The seller block on invoices and credit notes, from the environment (one source for the page and the PDF).
const { env } = require("../../config/env");

const websiteHost = () => {
  const site = String(env.PUBLIC_SITE_URL || String(env.FRONTEND_URL || "").split(",")[0] || "").trim();
  try {
    return new URL(site).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const companyDetails = () => ({
  name: env.COMPANY_LEGAL_NAME || env.BRAND_NAME,
  tagline: "Zanzibar · Tanzania",
  address: env.COMPANY_ADDRESS,
  phone: env.SUPPORT_PHONE,
  email: env.EMAIL_REPLY_TO,
  website: websiteHost(),
  tin: env.COMPANY_TIN,
  licence: env.COMPANY_LICENCE,
  vatRegistered: Boolean(env.VAT_REGISTERED),
  taxLabel: env.TAX_LABEL || "VAT",
  taxRate: Number(env.TAX_PERCENT || 0)
});

module.exports = { companyDetails };

// Emails and PDFs must not mention the previous brand (frontend/scripts/check-brand.mjs checks the built site).
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/brand-test";
process.env.JWT_SECRET ||= "brand-test-secret";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const OLD_NAME = ["r", "i", "s", "e", "r"].join("");
const PATTERN = new RegExp(`${OLD_NAME}|778[\s-]?775[\s-]?044`, "i");
const TEMPLATES = [
  "src/services/email/index.js",
  "src/services/invoiceDocuments/pdf.js",
  "src/services/invoiceDocuments/view.js",
  "src/services/invoiceDocuments/company.js",
  "src/services/invoiceDocuments/brandMark.js",
  "src/services/myBooking/ticketPdf.js",
  "src/config/env.js"
];

test("email and PDF templates carry no previous-brand text", () => {
  for (const file of TEMPLATES) {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.ok(!PATTERN.test(text), `${file} mentions the previous brand`);
  }
});

test("brand defaults are the new company", () => {
  const { env } = require("../src/config/env");
  assert.equal(env.BRAND_NAME, process.env.BRAND_NAME || "Zanzibar Tours & Safaris");
});

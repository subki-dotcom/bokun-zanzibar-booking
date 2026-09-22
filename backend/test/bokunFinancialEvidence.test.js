const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBokunFinancialEvidenceClient,
  normalizeBokunFinancialEvidence,
  normalizeInvoiceEvidence,
  normalizeInvoiceType,
  normalizeSellerInvoiceEvidence,
  normalizePaymentEvidence
} = require("../src/integrations/bokun/financialEvidence");
const {
  STATUS,
  buildAccountingPreview,
  buildStoredBokunFinancialPreview,
  classifyTransaction,
  reconcileBokunFinancialEvidence
} = require("../src/services/bokunFinancialReconciliation");
const {
  STATUS: REVENUE_BASIS_STATUS,
  applyRevenueCostCurrencyCheck,
  resolveVerifiedSupplierRevenueBasis
} = require("../src/services/profitability/revenueBasis");

const rawBooking = (overrides = {}) => ({
  booking: {
    bookingId: "BOKUN-1001",
    confirmationCode: "CONF-1001",
    productId: "EXP-1001",
    totalPrice: "100.00",
    totalPaid: "100.00",
    currency: "USD",
    paymentStatus: "PAID",
    paidType: "CARD",
    ...overrides
  }
});

test("v2 client uses existing signed request wrapper and only calls supported identifiers", async () => {
  const requests = [];
  const client = createBokunFinancialEvidenceClient({
    client: {
      request: async (request) => {
        requests.push(request);
        return {};
      }
    }
  });

  await client.fetchForBooking({
    booking: { bokunBookingId: "BOKUN-1001" },
    requestId: "financial-test"
  });

  assert.deepEqual(requests.map((request) => request.path), [
    "/restapi/v2.0/booking/BOKUN-1001/invoices?invoiceType=SELLER",
    "/restapi/v2.0/booking/BOKUN-1001/payments",
    "/restapi/v2.0/booking/BOKUN-1001/audit-records"
  ]);
  assert.equal(requests.every((request) => request.method === "get"), true);
});

test("marketplace endpoints are not called without both contract and experience identifiers", async () => {
  const requests = [];
  const client = createBokunFinancialEvidenceClient({
    client: { request: async (request) => { requests.push(request); return {}; } }
  });

  await client.fetchForBooking({ booking: { bokunBookingId: "BOKUN-1001" }, contractId: "CONTRACT-1" });
  assert.equal(requests.some((request) => request.path.includes("marketplace")), false);
});

test("live collection keeps embedded detail evidence when v2 invoice or payment endpoints reject", async () => {
  const requests = [];
  const client = createBokunFinancialEvidenceClient({
    client: {
      request: async (request) => {
        requests.push(request);
        if (request.path.includes("/invoices?invoiceType=SELLER")) throw Object.assign(new Error("invoice endpoint rejected"), { statusCode: 400, code: "BOKUN_REQUEST_FAILED" });
        if (request.path.endsWith("/payments")) throw Object.assign(new Error("payment endpoint denied"), { statusCode: 403, code: "BOKUN_REQUEST_FAILED" });
        if (request.path.endsWith("/audit-records")) return { auditRecords: [{ id: "AUD-2", action: "BOOK_CONFIRMED" }] };
        return {
          bookingId: "BOKUN-3001",
          confirmationCode: "GET-3001",
          totalPrice: "22",
          totalPaid: "22",
          currency: "EUR",
          invoice: { invoiceNumber: "INV-3001", totalAsMoney: { amount: "22", currency: "USD" } },
          customerPayments: [{ id: "PAY-3001", amount: "22", currency: "USD", paymentType: "VOUCHER" }]
        };
      }
    }
  });

  const bookingDetail = await client.getBookingDetail({ bookingId: "BOKUN-3001", confirmationCode: "GET-3001" });
  const evidence = await client.fetchForBooking({ booking: { bokunBookingId: "BOKUN-3001" }, bookingDetail });

  assert.equal(requests[0].path, "/booking.json/booking/GET-3001");
  assert.equal(evidence.invoiceEvidence[0].amount, "22");
  assert.equal(evidence.invoiceEvidence[0].currency, "USD");
  assert.equal(evidence.paymentEvidence[0].method, "VOUCHER");
  assert.equal(evidence.financialEndpointStatus.invoices.status, 400);
  assert.equal(evidence.financialEndpointStatus.payments.status, 403);
  assert.equal(evidence.financialEndpointStatus.auditRecords.status, "2xx");
});

test("v2 invoice and payment evidence preserves invoice type and decimal strings", () => {
  assert.equal(normalizeInvoiceType("CustomerInvoice"), "CustomerInvoice");
  assert.equal(normalizeInvoiceType("AffiliateInvoice"), "AffiliateInvoice");
  assert.equal(normalizeInvoiceType("unknown-invoice"), "UNKNOWN");

  const invoices = normalizeInvoiceEvidence({ invoices: [
    { id: "INV-1", type: "AffiliateInvoice", totalAmount: "25.00", currency: "USD" }
  ] });
  const payments = normalizePaymentEvidence({ payments: [
    { id: "PAY-1", amount: "100.00", currency: "USD", status: "PAID" }
  ] });

  assert.equal(invoices[0].type, "AffiliateInvoice");
  assert.equal(invoices[0].amount, "25");
  assert.equal(payments[0].amount, "100");
});

test("normalizes dynamic Bókun SELLER invoice commission and seller amount", () => {
  const seller = normalizeSellerInvoiceEvidence({
    bookingId: "104386641",
    sellerInvoices: {
      "146976238": {
        activeSellerInvoice: {
          id: 95836231,
          currency: "USD",
          issuerVendorId: 94592,
          recipientVendorId: 5197,
          total: "14.96",
          lineItems: [{ quantity: 2, unitPrice: "11.00", total: "14.96", commissionPercentage: "32.0", commissionAmount: "7.04" }]
        }
      }
    }
  }, "104386641");

  assert.equal(seller[0].source, "BOKUN_SELLER_INVOICE");
  assert.equal(seller[0].grossBasisAmount, "22");
  assert.equal(seller[0].commissionPercentage, "32");
  assert.equal(seller[0].commissionAmount, "7.04");
  assert.equal(seller[0].sellerInvoiceTotal, "14.96");
  assert.equal(seller[0].currency, "USD");
});

test("seller invoice commission is verified without settlement and currencies stay separate", () => {
  const evidence = normalizeBokunFinancialEvidence({
    booking: rawBooking({ totalPrice: "22", currency: "EUR" }),
    invoices: {
      bookingId: "BOKUN-1001",
      sellerInvoices: { contract: { activeSellerInvoice: { id: 1, currency: "USD", total: "14.96", lineItems: [{ quantity: 2, unitPrice: "11", commissionPercentage: "32", commissionAmount: "7.04" }] } } }
    }
  });
  const result = reconcileBokunFinancialEvidence({ booking: { salesChannel: "GETYOURGUIDE" }, evidence });

  assert.equal(result.otaCommissionStatus, "VERIFIED");
  assert.equal(result.settlementStatus, "NEEDS_REVIEW");
  assert.equal(result.expectedNetReceivable, "14.96");
  assert.equal(result.reasons.includes(STATUS.CURRENCY_MISMATCH), true);
  assert.equal(result.reasons.includes(STATUS.MISSING_SETTLEMENT), true);
});

test("missing seller invoice commission remains NEEDS_REVIEW", () => {
  const evidence = normalizeBokunFinancialEvidence({
    booking: rawBooking(),
    invoices: { sellerInvoices: { contract: { activeSellerInvoice: { id: 1, currency: "USD", total: "100", lineItems: [{ quantity: 1, unitPrice: "100" }] } } } }
  });
  const result = reconcileBokunFinancialEvidence({ booking: { salesChannel: "GETYOURGUIDE" }, evidence });
  assert.equal(result.otaCommissionStatus, "NEEDS_REVIEW");
  assert.equal(result.reasons.includes(STATUS.MISSING_COMMISSION), true);
});

test("normalizes booking, payment, and audit evidence without floating point conversion", () => {
  const evidence = normalizeBokunFinancialEvidence({
    booking: rawBooking(),
    invoices: { invoices: [{ id: "INV-1", type: "CustomerInvoice", totalAmount: "100.00", currency: "USD" }] },
    payments: { payments: [{ id: "PAY-1", amount: "100.00", currency: "USD", status: "PAID" }] },
    auditRecords: { auditRecords: [{ id: "AUD-1", action: "BOOKING_CONFIRMED" }] }
  });

  assert.equal(evidence.bookingId, "BOKUN-1001");
  assert.equal(evidence.grossAmount, "100");
  assert.equal(evidence.customerPaidAmount, "100");
  assert.equal(evidence.invoiceEvidence[0].type, "CustomerInvoice");
  assert.equal(evidence.paymentEvidence[0].amount, "100");
  assert.equal(evidence.auditEvidence[0].action, "BOOKING_CONFIRMED");
});

test("reconciles a reseller with decimal-safe gross, commission, and net", () => {
  const evidence = normalizeBokunFinancialEvidence({
    booking: rawBooking(),
    invoices: { invoices: [{ id: "INV-1", type: "SellerInvoice", totalAmount: "100.00", currency: "USD" }] },
    payments: { payments: [{ id: "PAY-1", amount: "100.00", currency: "USD", status: "PAID" }] },
    marketplace: {
      marketplaceContractId: "CONTRACT-1",
      marketplaceResellerId: "RESELLER-1",
      relationship: "RESELLER",
      commission: { amount: "25.00", currency: "USD", source: "BOKUN_MARKETPLACE_CONTRACT" }
    },
    auditRecords: { auditRecords: [{ id: "AUD-1" }] }
  });
  const booking = { salesChannel: "BOKUN_MARKETPLACE" };
  const result = reconcileBokunFinancialEvidence({ booking, evidence: { ...evidence, settlementEvidence: { source: "BOKUN_STATEMENT" }, expectedNetReceivable: "75.00" } });

  assert.equal(classifyTransaction({ booking, evidence: { marketplaceRelationship: "RESELLER" } }), "OTA_RESELLER");
  assert.equal(result.status, STATUS.MATCHED);
  assert.equal(result.expectedNetReceivable, "75");
  assert.equal(result.otaCommissionStatus, "VERIFIED");
});

test("missing commission, settlement, and currency conflicts require review", () => {
  const booking = { salesChannel: "VIATOR" };
  const missing = reconcileBokunFinancialEvidence({
    booking,
    evidence: { grossAmount: "100.00", grossCurrency: "USD", invoiceEvidence: [{ type: "CustomerInvoice" }], paymentEvidence: [] }
  });
  assert.equal(missing.status, STATUS.NEEDS_REVIEW);
  assert.equal(missing.reasons.includes(STATUS.MISSING_COMMISSION), true);
  assert.equal(missing.reasons.includes(STATUS.MISSING_SETTLEMENT), true);

  const conflict = reconcileBokunFinancialEvidence({
    booking,
    evidence: { grossAmount: "100.00", grossCurrency: "USD", otaCommissionAmount: "25.00", otaCommissionCurrency: "EUR", otaCommissionSource: "BOKUN_MARKETPLACE_CONTRACT", invoiceEvidence: [{ type: "SellerInvoice" }], paymentEvidence: [{ amount: "100.00" }], settlementEvidence: {} }
  });
  assert.equal(conflict.status, STATUS.CURRENCY_MISMATCH);
  assert.equal(conflict.reasons.includes(STATUS.CURRENCY_MISMATCH), true);
});

test("internal Riser agent commission never becomes OTA commission", () => {
  const booking = { agentId: "agent-john", sourceChannel: "AGENT_PORTAL", salesChannel: "DIRECT_WEBSITE" };
  const evidence = { grossAmount: "100.00", grossCurrency: "USD", invoiceEvidence: [{ type: "CustomerInvoice" }], paymentEvidence: [{ amount: "100.00" }] };
  const result = reconcileBokunFinancialEvidence({ booking, evidence: { ...evidence, agentCommissionAmount: "10.00" } });

  assert.equal(result.classification, "INTERNAL_RISER_AGENT");
  assert.equal(result.otaCommissionStatus, "NOT_APPLICABLE");
  assert.equal(result.reasons.includes(STATUS.MISSING_COMMISSION), false);
});

test("accounting preview is read-only and includes provenance", () => {
  const booking = { salesChannel: "BOKUN_MARKETPLACE" };
  const evidence = {
    grossAmount: "100.00",
    grossCurrency: "USD",
    otaCommissionAmount: "25.00",
    otaCommissionCurrency: "USD",
    otaCommissionSource: "BOKUN_MARKETPLACE_CONTRACT",
    invoiceEvidence: [{ type: "SellerInvoice" }],
    paymentEvidence: [{ amount: "100.00" }],
    settlementEvidence: { source: "BOKUN_STATEMENT" },
    marketplaceRelationship: "RESELLER",
    expectedNetReceivable: "75.00"
  };
  const reconciliation = reconcileBokunFinancialEvidence({ booking, evidence });
  const preview = buildAccountingPreview({ booking, evidence, reconciliation });

  assert.equal(preview.status, "PREVIEW");
  assert.deepEqual(preview.components.map((component) => component.source), [
    "RECONCILED_BOKUN_EVIDENCE",
    "BOKUN_MARKETPLACE_CONTRACT",
    "BOKUN_BOOKING_EVIDENCE"
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(preview, "journalEntry"), false);
});

test("stored Booking evidence produces a review-safe preview without requiring a live fetch", () => {
  const preview = buildStoredBokunFinancialPreview({
    booking: {
      salesChannel: "VIATOR",
      bokunFinancialEvidence: {
        status: "NEEDS_REVIEW",
        grossAmount: "100.00",
        currency: "USD",
        invoiceEvidence: [],
        paymentEvidence: []
      }
    }
  });

  assert.equal(preview.status, STATUS.NEEDS_REVIEW);
  assert.deepEqual(preview.components, []);
});

test("verified unreconciled GetYourGuide seller net is available for profitability", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "GETYOURGUIDE" },
    evidence: {
      source: "BOKUN",
      status: "VERIFIED",
      currency: "USD",
      sellerInvoiceEvidence: { sellerInvoiceTotal: "14.96", currency: "USD" },
      otaCommissionAmount: "7.04",
      reconciliationStatus: "UNRECONCILED"
    }
  });

  assert.equal(revenueBasis.amount, "14.96");
  assert.equal(revenueBasis.source, "BOKUN_MARKETPLACE_SELLER_INVOICE_NET");
  assert.equal(revenueBasis.status, REVENUE_BASIS_STATUS.VERIFIED);
  assert.equal(revenueBasis.reconciliationStatus, "UNRECONCILED");
});

test("seller net prevents OTA commission from being deducted twice", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "GETYOURGUIDE" },
    evidence: {
      source: "BOKUN",
      status: "VERIFIED",
      sellerInvoiceEvidence: { sellerInvoiceTotal: "14.96", currency: "USD" },
      otaCommissionAmount: "7.04"
    }
  });

  assert.equal(revenueBasis.amount, "14.96");
});

test("Viator uses verified supplier amount without an assumed commission", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "VIATOR" },
    evidence: {
      source: "BOKUN",
      status: "VERIFIED",
      grossAmount: "115.60",
      currency: "USD",
      sellerInvoiceEvidence: { sellerInvoiceTotal: "115.60", currency: "USD" },
      otaCommissionAmount: "0",
      otaCommissionStatus: "VERIFIED"
    }
  });

  assert.equal(revenueBasis.amount, "115.6");
  assert.equal(revenueBasis.source, "BOKUN_VIATOR_SUPPLIER_AMOUNT");
});

test("Viator does not fall back to gross when supplier amount is missing", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "VIATOR" },
    evidence: { source: "BOKUN", status: "VERIFIED", grossAmount: "115.60", currency: "USD" }
  });

  assert.equal(revenueBasis.status, REVENUE_BASIS_STATUS.UNKNOWN);
  assert.equal(revenueBasis.amount, null);
});

test("direct booking uses the authoritative pricing snapshot amount and currency", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: {
      salesChannel: "DIRECT_WEBSITE",
      amount: 999,
      currency: "USD",
      pricingSnapshot: { finalPayable: 100, currency: "USD" }
    }
  });

  assert.equal(revenueBasis.amount, "100");
  assert.equal(revenueBasis.currency, "USD");
  assert.equal(revenueBasis.source, "DIRECT_BOOKING_PRICING_SNAPSHOT_FINAL_PAYABLE");
  assert.equal(revenueBasis.status, REVENUE_BASIS_STATUS.VERIFIED);
});

test("direct booking with only arbitrary booking amount requires review", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "DIRECT_WEBSITE", amount: 100, currency: "USD" }
  });

  assert.equal(revenueBasis.amount, null);
  assert.equal(revenueBasis.status, REVENUE_BASIS_STATUS.UNKNOWN);
});

test("OTA booking never uses the direct booking fallback", () => {
  const revenueBasis = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "VIATOR", amount: 100, currency: "USD" }
  });

  assert.equal(revenueBasis.amount, null);
  assert.equal(revenueBasis.status, REVENUE_BASIS_STATUS.UNKNOWN);
});

test("verified GYG supplier revenue requires a currency and rejects negative amounts", () => {
  const missingCurrency = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "GETYOURGUIDE" },
    evidence: { source: "BOKUN", status: "VERIFIED", supplierNetAmount: "14.96" }
  });
  const negative = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "GETYOURGUIDE" },
    evidence: { source: "BOKUN", status: "VERIFIED", supplierNetAmount: "-14.96", supplierNetCurrency: "USD" }
  });

  assert.equal(missingCurrency.status, REVENUE_BASIS_STATUS.UNKNOWN);
  assert.equal(negative.status, REVENUE_BASIS_STATUS.UNKNOWN);
});

test("unknown supplier amount requires review and currency conflicts require FX review", () => {
  const unknown = resolveVerifiedSupplierRevenueBasis({
    booking: { salesChannel: "TOURHQ" },
    evidence: { source: "BOKUN", status: "VERIFIED", grossAmount: "100", currency: "USD" }
  });
  assert.equal(unknown.status, REVENUE_BASIS_STATUS.UNKNOWN);
  assert.equal(unknown.amount, null);

  const fxReview = applyRevenueCostCurrencyCheck({
    revenueBasis: { amount: "14.96", currency: "USD", status: REVENUE_BASIS_STATUS.VERIFIED },
    costCurrency: "EUR"
  });
  assert.equal(fxReview.status, REVENUE_BASIS_STATUS.NEEDS_REVIEW_FX);
});

test("normalizes persisted Booking financial fields used by read-only refresh", () => {
  const evidence = normalizeBokunFinancialEvidence({
    booking: {
      bokunBookingId: "BOKUN-2001",
      bokunProductId: "EXP-2001",
      amount: "125.50",
      currency: "USD",
      bookingPaymentReportedAmount: "100.25",
      bookingPaymentCurrency: "USD"
    },
    invoices: { invoices: [{ id: "INV-2", type: "CustomerInvoice", totalAmount: "125.50", currency: "USD" }] },
    payments: { payments: [{ id: "PAY-2", amount: "100.25", currency: "USD" }] }
  });

  assert.equal(evidence.bookingId, "BOKUN-2001");
  assert.equal(evidence.experienceId, "EXP-2001");
  assert.equal(evidence.grossAmount, "125.5");
  assert.equal(evidence.customerPaidAmount, "100.25");
  assert.equal(evidence.grossCurrency, "USD");
});

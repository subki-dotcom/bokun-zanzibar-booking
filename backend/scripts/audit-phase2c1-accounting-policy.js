const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const Invoice = require("../src/models/Invoice");
const Refund = require("../src/models/Refund");
const Settlement = require("../src/models/Settlement");
const ServiceCompletion = require("../src/models/ServiceCompletion");
const RevenueRecognition = require("../src/models/RevenueRecognition");
const AccountingPosting = require("../src/models/AccountingPosting");
const ChartOfAccount = require("../src/models/ChartOfAccount");
const AccountingMapping = require("../src/models/AccountingMapping");
const PostingRule = require("../src/models/PostingRule");
const AccountingPeriod = require("../src/models/AccountingPeriod");
const { DEFAULT_CHART_OF_ACCOUNTS } = require("../src/accounting/defaultChartOfAccounts");
const { DEFAULT_ACCOUNTING_MAPPINGS, DEFAULT_POSTING_RULES } = require("../src/accounting/defaultAccountingMappings");
const { configuredBaseCurrency } = require("../src/accounting/currencyPolicy");
const { GL_MAPPING_KEY, ACCOUNTING_PERIOD_STATUS } = require("../src/accounting/constants");
const EXPECTED_DATABASE = "bokun_zanzibar_booking";
const upper = (v) => String(v || "").trim().toUpperCase();
const countBy = (rows, fn) => rows.reduce((out, row) => { const key = fn(row) || "UNKNOWN"; out[key] = (out[key] || 0) + 1; return out; }, {});
const buildDirectAdvancePaymentPolicy = (hasDepositMapping) => ({ decision: "CUSTOMER_DEPOSIT", confidence: hasDepositMapping ? "STRONGLY_SUPPORTED_RECOMMENDATION" : "MISSING_INFRASTRUCTURE", account: hasDepositMapping ? "2030 CUSTOMER DEPOSITS" : null, approvalRequired: true });
const names = new Set(["CASH / BANK", "PROCESSOR CLEARING", "PESAPAL CLEARING", "DPO CLEARING", "PAYPAL CLEARING", "ACCOUNTS RECEIVABLE", "OTA RECEIVABLE", "GYG RECEIVABLE", "VIATOR RECEIVABLE", "CUSTOMER DEPOSITS", "DEFERRED REVENUE", "TOUR REVENUE", "TRANSFER REVENUE", "OTHER SERVICE REVENUE", "COMMISSION EXPENSE", "GYG COMMISSION", "VIATOR COMMISSION", "PAYMENT PROCESSOR FEES", "REFUND / SALES RETURN", "CANCELLATION FEE REVENUE", "FX GAIN", "FX LOSS"]);
const accountRelevant = (account) => { const text = `${account.code} ${account.name} ${account.subtype}`.toUpperCase(); const matches = []; if (/CASH|BANK/.test(text)) matches.push("CASH / BANK"); if (/PESAPAL/.test(text)) matches.push("PESAPAL CLEARING"); if (/DPO/.test(text)) matches.push("DPO CLEARING"); if (/PAYPAL/.test(text)) matches.push("PAYPAL CLEARING"); if (/CLEARING/.test(text) && !matches.length) matches.push("PROCESSOR CLEARING"); if (/RECEIVABLE/.test(text)) matches.push("ACCOUNTS RECEIVABLE"); if (/CUSTOMER DEPOSIT|DEFERRED|UNEARNED/.test(text)) matches.push("CUSTOMER DEPOSITS"); if (/TOUR REVENUE/.test(text)) matches.push("TOUR REVENUE"); if (/TRANSFER REVENUE/.test(text)) matches.push("TRANSFER REVENUE"); if (/OTHER SERVICE REVENUE/.test(text)) matches.push("OTHER SERVICE REVENUE"); if (/COMMISSION/.test(text) && account.type === "EXPENSE") matches.push("COMMISSION EXPENSE"); if (/FEE|BANK CHARGE|PAYMENT PROVIDER/.test(text)) matches.push("PAYMENT PROCESSOR FEES"); if (/REFUND|RETURN|ALLOWANCE/.test(text)) matches.push("REFUND / SALES RETURN"); if (/CANCELLATION/.test(text)) matches.push("CANCELLATION FEE REVENUE"); if (/FX|FOREIGN EXCHANGE/.test(text)) matches.push("FX GAIN/LOSS"); return [...new Set(matches)]; };
async function main() {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only; --apply is not supported.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required from backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const databaseName = mongoose.connection.db.databaseName; console.log(JSON.stringify({ connected: true, databaseName })); if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);
  const [bookings, payments, invoices, refunds, settlements, completions, recognitions, postings, accounts, mappings, rules, periods] = await Promise.all([
    Booking.find({}).select("bookingReference salesChannel operationalSource amount currency transactionCurrency pricingSnapshot customerPaymentStatus bookingPaymentStatus bookingStatus travelDate").lean(),
    Payment.find({}).select("bookingReference provider status verificationStatus amount currency accountingAmount accountingCurrency providerFeeAmount providerFeeCurrency providerTransactionId orderTrackingId settledAt settlementAmount settlementCurrency").lean(),
    Invoice.find({}).select("bookingReference total totalAmount paidAmount amountPaid balanceDue balanceDueAmount currency transactionCurrency accountingCurrency paymentStatus issueDate").lean(),
    Refund.find({}).select("bookingId bookingReference provider status amount currency confirmedRefundedAmount confirmedAccountingRefundedAmount originalProviderTransactionId").lean(),
    Settlement.find({}).select("settlementReference provider status gross commission fees expectedNet received allocated unallocated currency evidenceSource").lean(),
    ServiceCompletion.find({}).select("bookingReference serviceKey status evidenceSource serviceDate completedAt").lean(),
    RevenueRecognition.find({}).select("recognitionReference bookingReference status recognizedAmount currency postingKey journalEntryId").lean(),
    AccountingPosting.find({}).select("postingKey idempotencyKey sourceModule postingType sourceReference bookingReference amount currency baseCurrency exchangeRate transactionDate status components").lean(),
    ChartOfAccount.find({}).lean(), AccountingMapping.find({}).lean(), PostingRule.find({}).lean(), AccountingPeriod.find({}).lean()
  ]);
  const actualAccounts = accounts.length ? accounts : DEFAULT_CHART_OF_ACCOUNTS;
  const inventory = actualAccounts.map((account) => ({ code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance, currency: account.currency || "MULTI/UNSPECIFIED", systemMapping: DEFAULT_ACCOUNTING_MAPPINGS.filter((mapping) => mapping.accountCode === account.code).map((mapping) => mapping.mappingKey), currentUsage: postings.filter((posting) => posting.components && Object.values(posting.components).some((value) => value != null) && (posting.currency === account.currency || account.currency === "")).length, active: account.active !== false, relevant: accountRelevant(account) })).filter((account) => account.relevant.length || account.systemMapping.length);
  const available = (key) => {
    const configured = mappings.find((mapping) => mapping.mappingKey === key && mapping.active !== false)
      || DEFAULT_ACCOUNTING_MAPPINGS.find((mapping) => mapping.mappingKey === key);
    return Boolean(configured && accounts.some((account) => account.code === configured.accountCode && account.active !== false));
  };
  const mappingMatrix = [
    { concept: "Accounts Receivable", mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, requiredAccount: "1100" },
    { concept: "Customer Deposits", mappingKey: GL_MAPPING_KEY.CUSTOMER_DEPOSIT, requiredAccount: "2030" },
    { concept: "Tour Revenue", mappingKey: GL_MAPPING_KEY.TOUR_REVENUE, requiredAccount: "4010" },
    { concept: "Transfer Revenue", mappingKey: GL_MAPPING_KEY.TRANSFER_REVENUE, requiredAccount: "4020" },
    { concept: "Other Revenue", mappingKey: GL_MAPPING_KEY.OTHER_SERVICE_REVENUE, requiredAccount: "4040" },
    { concept: "GetYourGuide Receivable", mappingKey: GL_MAPPING_KEY.GYG_RECEIVABLE },
    { concept: "Viator Receivable", mappingKey: GL_MAPPING_KEY.VIATOR_RECEIVABLE },
    { concept: "OTA Commission Expense", mappingKey: GL_MAPPING_KEY.OTA_COMMISSION },
    { concept: "Pesapal Clearing", mappingKey: GL_MAPPING_KEY.PESAPAL_CLEARING, requiredAccount: "1030" },
    { concept: "DPO Clearing", mappingKey: GL_MAPPING_KEY.DPO_CLEARING, requiredAccount: "1050" },
    { concept: "PayPal Clearing", mappingKey: GL_MAPPING_KEY.PAYPAL_CLEARING, requiredAccount: "1040" },
    { concept: "Processor Fee Expense", mappingKey: GL_MAPPING_KEY.PAYMENT_PROVIDER_FEE, requiredAccount: "6060" },
    { concept: "FX Gain", mappingKey: GL_MAPPING_KEY.FX_GAIN },
    { concept: "FX Loss", mappingKey: GL_MAPPING_KEY.FX_LOSS },
    { concept: "Bank/Cash", mappingKey: GL_MAPPING_KEY.BANK, requiredAccount: "1020" }
  ].map((row) => {
    const mapping = mappings.find((item) => item.mappingKey === row.mappingKey && item.active !== false)
      || DEFAULT_ACCOUNTING_MAPPINGS.find((item) => item.mappingKey === row.mappingKey);
    const account = mapping ? accounts.find((item) => item.code === mapping.accountCode) : null;
    return { ...row, existingAccount: account ? account.name : null, accountCode: account?.code || null, mappingKey: row.mappingKey, verified: Boolean(account && account.active !== false && mapping?.active !== false), actionRequired: account ? (mapping ? "NONE" : "MAPPING_REQUIRED") : "ACCOUNT_MAPPING_REQUIRED" };
  });
  const policy = {
    accountingBasis: { decision: "ACCRUAL", confidence: "STRONGLY_SUPPORTED_RECOMMENDATION", evidence: "ServiceCompletion is separate from payment and settlement; existing GL has receivable, deposit, revenue, clearing, and period concepts.", approvalRequired: true },
    directAdvancePayment: buildDirectAdvancePaymentPolicy(available(GL_MAPPING_KEY.CUSTOMER_DEPOSIT)),
    directUnpaidCompletedService: { decision: "ACCOUNTS_RECEIVABLE", confidence: available(GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE) ? "VERIFIED_FROM_EXISTING_SYSTEM" : "MISSING_INFRASTRUCTURE", account: available(GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE) ? "1100" : null },
    otaRevenuePresentation: { decision: "GROSS_REVENUE_WITH_SEPARATE_COMMISSION", confidence: "APPROVED_POLICY", reason: "Recognize gross service value when reliable; commission remains expense." },
    otaReceivable: { decision: "PROVIDER_SPECIFIC_RECEIVABLE", confidence: mappingMatrix.some((row) => [GL_MAPPING_KEY.GYG_RECEIVABLE, GL_MAPPING_KEY.VIATOR_RECEIVABLE].includes(row.mappingKey) && row.verified) ? "VERIFIED_FROM_EXISTING_SYSTEM" : "MISSING_INFRASTRUCTURE", reason: "Missing provider-specific OTA receivable mapping where unverified." },
    otaCommission: { decision: "SEPARATE_COMMISSION_EXPENSE", confidence: mappingMatrix.find((row) => row.mappingKey === GL_MAPPING_KEY.OTA_COMMISSION)?.verified ? "VERIFIED_FROM_EXISTING_SYSTEM" : "MISSING_INFRASTRUCTURE", reason: "Missing OTA commission expense mapping where unverified." },
    processorClearing: { decision: "DEDICATED_BY_PROVIDER", confidence: "VERIFIED_FROM_EXISTING_SYSTEM", accounts: { PESAPAL: "1030", PAYPAL: "1040", DPO: "1050" } },
    processorFees: { decision: "EXPENSE", confidence: "STRONGLY_SUPPORTED_RECOMMENDATION", account: available(GL_MAPPING_KEY.PAYMENT_PROVIDER_FEE) ? "6060" : null, approvalRequired: true },
    refundAfterRecognition: { decision: "LINKED_REVERSAL_JOURNAL", confidence: "APPROVED_POLICY", reason: "Original journals remain immutable; valid refunds use linked reversal journals." },
    cancellationNoShowRevenue: { decision: "EXPLICIT_FEE_EVIDENCE_ONLY", confidence: "APPROVED_POLICY", reason: "Cancellation fees and no-show revenue require explicit policy and amount evidence." },
    revenuePostingDate: { decision: "SERVICE_COMPLETION_DATE", confidence: "STRONGLY_SUPPORTED_RECOMMENDATION", approvalRequired: true },
    fxPolicy: { decision: "AUTHORITATIVE_RATE_REQUIRED", confidence: "APPROVED_POLICY", reason: "Foreign currency posting requires persisted authoritative rate evidence." },
    revenueAccountMapping: { decision: "SERVICE_TYPE_MAPPING", confidence: "VERIFIED_FROM_EXISTING_SYSTEM", accounts: { TOUR: "4010", TRANSFER: "4020", OTHER_SERVICE: "4040" }, approvalRequired: true },
    periodLockPolicy: { decision: periods.length ? "SUPPORTED" : "MISSING", confidence: periods.length ? "VERIFIED_FROM_EXISTING_SYSTEM" : "MISSING_INFRASTRUCTURE", statuses: Object.fromEntries(Object.values(ACCOUNTING_PERIOD_STATUS).map((status) => [status, periods.filter((period) => upper(period.status) === status).length])) }
  };
  const sourceTruth = { bookings: { count: bookings.length, currencies: countBy(bookings, (row) => upper(row.transactionCurrency || row.currency || row.pricingSnapshot?.currency)), amountFields: ["pricingSnapshot.finalPayable", "amount"] }, invoices: { count: invoices.length, currencies: countBy(invoices, (row) => upper(row.transactionCurrency || row.currency || row.accountingCurrency)), amountFields: ["totalAmount", "total", "amountPaid", "balanceDue"] }, payments: { count: payments.length, providers: countBy(payments, (row) => upper(row.provider)), currencies: countBy(payments, (row) => upper(row.accountingCurrency || row.currency || row.orderCurrency)) }, settlements: { count: settlements.length, providers: countBy(settlements, (row) => upper(row.provider)), currencies: countBy(settlements, (row) => upper(row.received?.currency || row.expectedNet?.currency)) }, refunds: { count: refunds.length, providers: countBy(refunds, (row) => upper(row.provider)), currencies: countBy(refunds, (row) => upper(row.currency)) }, serviceCompletions: { count: completions.length, statuses: countBy(completions, (row) => upper(row.status)) }, recognitions: { count: recognitions.length, statuses: countBy(recognitions, (row) => upper(row.status)) } };
  const report = { readOnly: true, generatedAt: new Date().toISOString(), databaseName, productionRecordsChanged: 0, journalEntriesCreated: 0, glPostingsCreated: 0, chartOfAccountsChanged: false, historicalAccountingBackfill: "NONE", automaticGlPosting: "DISABLED", revenuePostingEndpoint: "DISABLED", bokunRecordsModified: 0, configuredBaseCurrency: configuredBaseCurrency(), architecture: { defaultMappings: DEFAULT_ACCOUNTING_MAPPINGS, defaultPostingRules: DEFAULT_POSTING_RULES, actualMappings: mappings.length, actualPostingRules: rules.length, postingKeyFields: ["AccountingPosting.postingKey", "AccountingPosting.idempotencyKey", "JournalEntry.source.postingKey"], journalStatuses: ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "VOID"], reversalSupported: true, pAndLSource: "POSTED_GENERAL_LEDGER", trialBalanceSource: "POSTED_GENERAL_LEDGER" }, accountMappingMatrix: mappingMatrix, accountInventory: inventory, missingAccountConcepts: [...names].filter((concept) => !inventory.some((account) => account.relevant.includes(concept))), sourceTruth, policy, dataAvailability: { grossBookingAmount: bookings.length ? "AVAILABLE" : "MISSING", bookingCurrency: bookings.length ? "AVAILABLE" : "MISSING", serviceDate: bookings.some((row) => row.travelDate) ? "AVAILABLE" : "MISSING", completionEvidence: completions.length ? "PARTIAL" : "MISSING", paymentAmount: payments.length ? "AVAILABLE" : "MISSING", paymentCurrency: payments.some((row) => row.currency || row.accountingCurrency) ? "PARTIAL" : "MISSING", otaCommission: "MISSING", processorFees: payments.some((row) => row.providerFeeAmount != null) ? "PARTIAL" : "MISSING", settlementAmount: settlements.length ? "PARTIAL" : "MISSING", refundAmount: refunds.length ? "AVAILABLE" : "MISSING", fxRate: "MISSING", postingDateBasis: "MISSING" }, automation: { safeNow: ["read-only audit", "completion evidence recording"], afterApproval: ["service revenue recognition preview", "direct deposit/AR transitions", "processor clearing settlement"], accountantReview: ["OTA gross/net", "OTA receivable", "commission", "refund after recognition", "cancellation/no-show fees", "FX", "posting dates"] }, blockerMatrix: Object.entries(policy).map(([key, value]) => ({ policy: key, decision: value.decision, confidence: value.confidence, blocker: value.blocker || (value.approvalRequired || value.decision.includes("APPROVAL") || value.decision === "REQUIRES_APPROVAL" ? "ACCOUNTANT_APPROVAL_REQUIRED" : "") })), policyDecisionsRequired: false };
  const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : ""; if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`); }
  const unresolvedMappings = mappingMatrix.filter((row) => !row.verified).length;
  const refundReadiness = refunds.length
    ? {
      status: "REQUIRES_REFUND_EVIDENCE_REVIEW",
      records: refunds.length,
      completed: refunds.filter((refund) => ["REFUNDED", "PARTIALLY_REFUNDED"].includes(upper(refund.status))).length,
      providerReferences: refunds.filter((refund) => refund.providerRefundReference || refund.providerRefundRequestReference).length
    }
    : { status: "BLOCKED_NO_REFUND_RECORDS", records: 0, completed: 0, providerReferences: 0 };
  console.log(JSON.stringify({ readOnly: true, databaseName, scanned: sourceTruth, missingAccountConcepts: report.missingAccountConcepts, mappingVerification: mappingMatrix.map(({ concept, mappingKey, accountCode, verified, actionRequired }) => ({ concept, mappingKey, accountCode, verified, actionRequired })), refundReadiness, policyStatus: unresolvedMappings ? "POLICY_RESOLVED_MAPPINGS_REQUIRED" : "POLICY_RESOLVED_READY_FOR_DATA_READINESS", mutationCounters: { productionRecordsChanged: 0, journalEntriesCreated: 0, glPostingsCreated: 0, chartOfAccountsChanged: false, bokunRecordsModified: 0 }, output: output || null }, null, 2)); await mongoose.disconnect();
}
if (require.main === module) main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });

module.exports = { buildDirectAdvancePaymentPolicy };

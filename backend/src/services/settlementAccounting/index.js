// Posts provider payouts (Pesapal/DPO/PayPal clearing -> bank) to the general ledger from reconciled settlement
// evidence. Without this, verified customer cash stays in the provider clearing account forever.
const Settlement = require("../../models/Settlement");
const SettlementAllocation = require("../../models/SettlementAllocation");
const Payment = require("../../models/Payment");
const AccountingPeriod = require("../../models/AccountingPeriod");
const AccountingMapping = require("../../models/AccountingMapping");
const ChartOfAccount = require("../../models/ChartOfAccount");
const JournalEntry = require("../../models/JournalEntry");
const JournalEntryLine = require("../../models/JournalEntryLine");
const RevenueRecognition = require("../../models/RevenueRecognition");
const { DEFAULT_ACCOUNTING_MAPPINGS } = require("../../accounting/defaultAccountingMappings");
const { GL_MAPPING_KEY, GL_POSTING_TYPE, SOURCE_MODULE } = require("../../accounting/constants");
const ledger = require("../generalLedger/ledger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { normalizeCurrency, toDecimal } = require("../../utils/money");

const PROVIDER_CLEARING = Object.freeze({
  PESAPAL: GL_MAPPING_KEY.PESAPAL_CLEARING,
  PAYPAL: GL_MAPPING_KEY.PAYPAL_CLEARING,
  DPO: GL_MAPPING_KEY.DPO_CLEARING
});
const POSTABLE_STATUSES = ["RECEIVED", "RECONCILED"];
// OTA revenue is recognized at verified supplier net (Revenue Recognition README), so the OTA receivable already
// excludes commission and a payout clears it without another commission entry.
const OTA_RECEIVABLE = Object.freeze({
  GETYOURGUIDE: GL_MAPPING_KEY.GYG_RECEIVABLE,
  VIATOR: GL_MAPPING_KEY.VIATOR_RECEIVABLE
});

const normalize = (value) => String(value || "").trim().toUpperCase();
const positive = (value) => {
  try { return toDecimal(value ?? 0, { allowNegative: false }).greaterThan(0); } catch { return false; }
};

// Same key ledger.postProviderSettlement derives, so posting twice returns the existing journal.
const settlementPostingKey = (settlement = {}) =>
  [SOURCE_MODULE.CASH_MOVEMENT, String(settlement._id || ""), GL_POSTING_TYPE.PROVIDER_SETTLEMENT].join(":");

const createSettlementAccountingService = ({
  SettlementModel = Settlement,
  AllocationModel = SettlementAllocation,
  PaymentModel = Payment,
  PeriodModel = AccountingPeriod,
  MappingModel = AccountingMapping,
  AccountModel = ChartOfAccount,
  JournalModel = JournalEntry,
  LineModel = JournalEntryLine,
  RecognitionModel = RevenueRecognition,
  Ledger = ledger,
  config = env
} = {}) => {
  const mappedAccount = async (mappingKey) => {
    const mapping = await MappingModel.findOne({ mappingKey, active: true }).lean()
      || DEFAULT_ACCOUNTING_MAPPINGS.find((item) => item.mappingKey === mappingKey);
    if (!mapping?.accountCode) return null;
    return AccountModel.findOne({ code: mapping.accountCode, active: { $ne: false } }).lean();
  };
  const hasActiveMapping = async (mappingKey) => Boolean(await mappedAccount(mappingKey));

  // Every allocated booking must have posted OTA recognition and enough receivable left on the ledger.
  const evaluateOtaAllocations = async ({ settlement, receivableKey }) => {
    const blockers = [];
    const account = await mappedAccount(receivableKey);
    if (!account || account.subtype !== "ACCOUNTS_RECEIVABLE") return { blockers: ["OTA_RECEIVABLE_MAPPING_REQUIRED"], allocations: [] };
    const allocations = await AllocationModel.find({ settlementId: settlement._id, status: "APPLIED" }).lean();
    if (!allocations.length) blockers.push("SETTLEMENT_ALLOCATION_REQUIRED");
    const allocated = allocations.reduce((sum, row) => sum.plus(toDecimal(String(row.amount))), toDecimal(0));
    if (!allocated.equals(toDecimal(String(settlement.received?.amount ?? 0)))) blockers.push("OTA_SETTLEMENT_NOT_FULLY_ALLOCATED");
    for (const allocation of allocations) {
      const recognition = await RecognitionModel.findOne({ bookingReference: allocation.bookingReference, status: { $in: ["POSTED", "PARTIALLY_REVERSED"] } }).lean();
      if (!recognition) { blockers.push("OTA_REVENUE_NOT_RECOGNIZED"); continue; }
      const lines = await LineModel.find({ bookingReference: allocation.bookingReference, accountCode: account.code, journalStatus: "POSTED" }).lean();
      const open = lines.reduce((sum, line) => sum.plus(toDecimal(String(line.baseCurrencyDebit ?? 0))).minus(toDecimal(String(line.baseCurrencyCredit ?? 0))), toDecimal(0));
      if (toDecimal(String(allocation.amount)).greaterThan(open)) blockers.push("OTA_ALLOCATION_EXCEEDS_RECEIVABLE");
    }
    return { blockers, allocations };
  };

  // A fee booked on a payment already moved out of clearing; posting it again at settlement would double count.
  const feeAlreadyPostedOnPayments = async (settlementId) => {
    const allocations = await AllocationModel.find({ settlementId, status: "APPLIED" }).lean();
    const references = [...new Set(allocations.map((allocation) => allocation.bookingReference).filter(Boolean))];
    if (!references.length) return false;
    const payments = await PaymentModel.find({ bookingReference: { $in: references }, status: "paid", accountingStatus: "POSTED" }).lean();
    return payments.some((payment) => positive(payment.providerFeeAmount));
  };

  const evaluate = async ({ settlement } = {}) => {
    const blockers = [];
    const provider = normalize(settlement?.provider);
    const clearingKey = PROVIDER_CLEARING[provider];
    const receivableKey = OTA_RECEIVABLE[provider];
    if (!settlement?._id) blockers.push("IDENTITY_CONFLICT");
    if (!POSTABLE_STATUSES.includes(normalize(settlement?.status))) blockers.push("SETTLEMENT_NOT_RECEIVED");
    if (receivableKey) blockers.push(...(await evaluateOtaAllocations({ settlement, receivableKey })).blockers);
    else if (!clearingKey) blockers.push("MISSING_CLEARING_ACCOUNT");
    else if (!(await hasActiveMapping(clearingKey))) blockers.push("MISSING_CLEARING_ACCOUNT");
    if (!(await hasActiveMapping(GL_MAPPING_KEY.BANK))) blockers.push("MISSING_BANK_ACCOUNT");
    if (!positive(settlement?.received?.amount)) blockers.push("RECEIVED_AMOUNT_REQUIRED");
    const currency = normalizeCurrency(settlement?.received?.currency || "");
    if (!currency) blockers.push("MISSING_SETTLEMENT_CURRENCY");
    else if (currency !== normalize(config.ACCOUNTING_BASE_CURRENCY)) blockers.push("FX_POLICY_REQUIRED");
    if (settlement?.fees && normalizeCurrency(settlement.fees.currency) && normalizeCurrency(settlement.fees.currency) !== currency) {
      blockers.push("FEE_CURRENCY_MISMATCH");
    }
    if (!settlement?.settlementDate) blockers.push("SETTLEMENT_DATE_REQUIRED");
    else {
      const period = await PeriodModel.findOne({ startDate: { $lte: settlement.settlementDate }, endDate: { $gte: settlement.settlementDate } }).lean();
      if (!period) blockers.push("PERIOD_NOT_FOUND");
      else if (["CLOSED", "LOCKED"].includes(normalize(period.status))) blockers.push("POSTING_BLOCKED_CLOSED_PERIOD");
    }
    const postingKey = settlementPostingKey(settlement);
    if (await JournalModel.findOne({ "source.postingKey": postingKey }).lean()) blockers.push("ALREADY_POSTED");
    const unique = [...new Set(blockers)];
    return { eligible: unique.length === 0, blockers: unique, postingKey };
  };

  const preview = async ({ settlementId }) => {
    const settlement = await SettlementModel.findById(settlementId).lean();
    if (!settlement) throw new AppError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND");
    return { settlement: { id: settlement._id, settlementReference: settlement.settlementReference, provider: settlement.provider }, eligibility: await evaluate({ settlement }), automationEnabled: config.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED === true };
  };

  const post = async ({ settlementId, auth = {}, requestId = "" }) => {
    const settlement = await SettlementModel.findById(settlementId).lean();
    if (!settlement) throw new AppError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND");
    const eligibility = await evaluate({ settlement });
    if (!eligibility.eligible) return { action: eligibility.blockers.includes("ALREADY_POSTED") ? "existing" : "blocked", eligibility };
    if (config.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED !== true) return { action: "preview", eligibility };
    const receivableKey = OTA_RECEIVABLE[normalize(settlement.provider)];
    if (receivableKey) {
      const { allocations } = await evaluateOtaAllocations({ settlement, receivableKey });
      const otaResult = await Ledger.postSourceEvent({
        event: {
          sourceModule: SOURCE_MODULE.CASH_MOVEMENT,
          sourceEntityType: "ProviderSettlement",
          sourceEntityId: String(settlement._id),
          sourceReference: settlement.settlementReference,
          postingType: GL_POSTING_TYPE.PROVIDER_SETTLEMENT,
          postingKey: eligibility.postingKey,
          postingDate: settlement.settlementDate,
          description: `OTA payout ${settlement.provider} ${settlement.settlementReference}`,
          currency: settlement.received.currency,
          lines: [
            { mappingKey: GL_MAPPING_KEY.BANK, debit: String(settlement.received.amount) },
            ...allocations.map((allocation) => ({ mappingKey: receivableKey, credit: String(allocation.amount), bookingReference: allocation.bookingReference }))
          ],
          sourceSnapshot: { settlementId: String(settlement._id), allocations: allocations.map((row) => ({ bookingReference: row.bookingReference, amount: String(row.amount) })) }
        },
        auth,
        requestId
      });
      return { action: otaResult?.action || "posted", journal: otaResult?.journal || otaResult, eligibility };
    }
    const result = await Ledger.postProviderSettlement({
      settlement: {
        id: String(settlement._id),
        reference: settlement.settlementReference,
        provider: settlement.provider,
        amount: String(settlement.received.amount),
        fee: settlement.fees?.amount ? String(settlement.fees.amount) : "0",
        feeAlreadyPosted: await feeAlreadyPostedOnPayments(settlement._id),
        currency: settlement.received.currency,
        settledAt: settlement.settlementDate
      },
      auth,
      requestId
    });
    return { action: result?.action || "posted", journal: result?.journal || result, eligibility };
  };

  return { evaluate, preview, post };
};

module.exports = { createSettlementAccountingService, settlementPostingKey, ...createSettlementAccountingService() };

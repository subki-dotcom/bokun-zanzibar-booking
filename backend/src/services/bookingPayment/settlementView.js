const Payment = require("../../models/Payment");
const PaymentAllocation = require("../../models/PaymentAllocation");
const Settlement = require("../../models/Settlement");
const SettlementAllocation = require("../../models/SettlementAllocation");
const { toDecimal, normalizeCurrency } = require("../../utils/money");

const decimal = (value) => {
  if (value === null || value === undefined || value === "") return null;
  try { return toDecimal(value, { allowNegative: false }); } catch { return null; }
};
const currencyCode = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  return normalizeCurrency(value);
};
const addMoney = (totals, amount, currency) => {
  const value = decimal(amount);
  const code = currencyCode(currency);
  if (!value || !code) return false;
  totals.set(code, (totals.get(code) || toDecimal(0)).plus(value));
  return true;
};
const serialize = (totals) => [...totals].map(([currency, amount]) => ({ currency, amount: amount.toFixed() }));
const validDate = (value) => value && Number.isFinite(new Date(value).getTime());

// A provider capture and an accounting allocation are not proof of bank settlement.
// Expected amounts must be explicit net settlement evidence, never invoice balance/gross.
const summarizeSettlement = (payments = [], allocations = [], context = {}) => {
  const received = new Map();
  const allocated = new Map();
  const fees = new Map();
  const seenPayments = new Set();
  const seenAllocations = new Set();
  const allocationsByPayment = new Map();
  for (const allocation of allocations) {
    const key = String(allocation.paymentId);
    if (!allocationsByPayment.has(key)) allocationsByPayment.set(key, []);
    allocationsByPayment.get(key).push(allocation);
  }
  let reviewCount = 0;
  let evidenceCount = 0;
  let unknownReceiptAmount = false;
  for (const payment of payments) {
    const id = String(payment._id || "");
    if (!id || seenPayments.has(id)) continue;
    seenPayments.add(id);
    if (payment.reconciliation?.reviewed) reviewCount += 1;
    if (payment.verificationStatus !== "verified") continue;
    const applied = (allocationsByPayment.get(id) || []).filter((allocation) => allocation.status === "applied");
    const uniqueApplied = applied.filter((allocation) => {
      const key = String(allocation.allocationKey || allocation._id || "");
      if (!key || seenAllocations.has(key)) return false;
      seenAllocations.add(key);
      return true;
    });
    for (const allocation of uniqueApplied) addMoney(allocated, allocation.amount, allocation.currency);
    if (validDate(payment.settledAt)) {
      evidenceCount += 1;
      if (!addMoney(received, payment.settlementAmount, payment.settlementCurrency)) unknownReceiptAmount = true;
      addMoney(fees, payment.providerFeeAmount, payment.providerFeeCurrency);
    } else if (["manual_bank", "cash_on_arrival"].includes(payment.provider)) {
      // Verified, applied manual receipts are actual cash/bank evidence.
      for (const allocation of uniqueApplied) {
        evidenceCount += 1;
        if (!addMoney(received, allocation.amount, allocation.currency)) unknownReceiptAmount = true;
      }
    }
  }
  const receivedByCurrency = serialize(received);
  const expected = decimal(context.expectedAmount);
  const expectedCurrency = currencyCode(context.currency);
  let status = evidenceCount ? "RECEIVED" : "PENDING";
  if (evidenceCount && expected?.isPositive() && expectedCurrency && !unknownReceiptAmount && received.size === 1 && received.has(expectedCurrency) && received.get(expectedCurrency).lessThan(expected)) {
    status = "PARTIALLY_RECEIVED";
  }
  const amount = unknownReceiptAmount || received.size > 1 ? null : receivedByCurrency[0]?.amount || 0;
  const currency = received.size === 1 ? receivedByCurrency[0].currency : received.size ? null : expectedCurrency || null;
  return {
    status,
    expectedAmount: expected && expectedCurrency ? expected.toFixed() : null,
    expectedCurrency: expected && expectedCurrency ? expectedCurrency : null,
    receivedAmount: amount,
    currency,
    receivedByCurrency,
    cashReceivedByCurrency: receivedByCurrency,
    allocatedByCurrency: serialize(allocated),
    providerFeesByCurrency: serialize(fees),
    evidenceCount,
    reconciliationStatus: "UNAVAILABLE",
    reconciliationSupported: false,
    cashReceipt: { status: evidenceCount ? "CONFIRMED" : "NONE", amount, currency, amountsByCurrency: receivedByCurrency },
    reconciliation: { status: "UNAVAILABLE", supported: false },
    reviewedPaymentCount: reviewCount,
    source: "LOCAL_ACCOUNTING",
    limitations: [
      "Provider capture/allocation alone is not bank settlement. Received amounts use dated provider settlement or verified applied manual cash/bank receipts.",
      "Payment review is not bank reconciliation. Channel net payout expectations are unavailable unless supplied explicitly.",
      "Expected payout unavailable; no channel payout ledger."
    ]
  };
};

// Exactly two batch reads regardless of the number of bookings; no writes/postings.
const loadSettlementViews = async (references = [], contexts = new Map()) => {
  const refs = [...new Set(references.map((reference) => String(reference || "").trim()).filter(Boolean))];
  if (!refs.length) return new Map();
  const [payments, allocations, settlementAllocations] = await Promise.all([
    Payment.find({ bookingReference: { $in: refs } }).select("bookingReference provider verificationStatus settlementAmount settlementCurrency settledAt providerFeeAmount providerFeeCurrency reconciliation.reviewed").lean(),
    PaymentAllocation.find({ bookingReference: { $in: refs }, status: "applied" }).select("bookingReference paymentId allocationKey amount currency status").lean(),
    SettlementAllocation.find({ bookingReference: { $in: refs }, status: "APPLIED" }).select("bookingReference settlementId amount currency status").lean()
  ]);
  const settlementIds = [...new Set(settlementAllocations.map((row) => String(row.settlementId)).filter(Boolean))];
  const settlements = settlementIds.length ? await Settlement.find({ _id: { $in: settlementIds } }).select("provider status expectedNet received allocated unallocated settlementDate evidenceSource settlementReference").lean() : [];
  const settlementById = new Map(settlements.map((row) => [String(row._id), row]));
  const groupedPayments = new Map(refs.map((ref) => [ref, []]));
  const groupedAllocations = new Map(refs.map((ref) => [ref, []]));
  for (const payment of payments) groupedPayments.get(payment.bookingReference)?.push(payment);
  for (const allocation of allocations) groupedAllocations.get(allocation.bookingReference)?.push(allocation);
  return new Map(refs.map((ref) => {
    const rows = settlementAllocations.filter((allocation) => allocation.bookingReference === ref).map((allocation) => ({ allocation, settlement: settlementById.get(String(allocation.settlementId)) })).filter(({ settlement }) => settlement);
    if (!rows.length) return [ref, summarizeSettlement(groupedPayments.get(ref), groupedAllocations.get(ref), contexts.get?.(ref) || contexts[ref] || {})];
    const first = rows[0].settlement;
    const received = rows.reduce((sum, row) => sum.plus(toDecimal(row.allocation.amount || 0)), toDecimal(0));
    const currency = rows.every((row) => currencyCode(row.allocation.currency) === currencyCode(first.received?.currency || row.allocation.currency)) ? currencyCode(first.received?.currency || rows[0].allocation.currency) : null;
    return [ref, { status: first.status || "UNKNOWN", expectedAmount: first.expectedNet?.amount?.toString?.() || null, expectedCurrency: first.expectedNet?.currency || null, receivedAmount: received.toFixed(), currency, receivedByCurrency: currency ? [{ amount: received.toFixed(), currency }] : [], allocatedByCurrency: [{ amount: received.toFixed(), currency: currency || rows[0].allocation.currency }], provider: first.provider, settlementReferences: rows.map(() => first.settlementReference), lastSettlementDate: first.settlementDate || null, evidenceSource: first.evidenceSource, evidenceCount: rows.length, reconciliation: { status: first.status === "RECONCILED" ? "RECONCILED" : "UNAVAILABLE", supported: first.status === "RECONCILED" }, reconciliationStatus: first.status === "RECONCILED" ? "RECONCILED" : "UNAVAILABLE", source: "SETTLEMENT_DOMAIN", cashReceipt: { status: first.received ? "CONFIRMED" : "NONE", amount: received.toFixed(), currency } }];
  }));
};

module.exports = { summarizeSettlement, loadSettlementViews };

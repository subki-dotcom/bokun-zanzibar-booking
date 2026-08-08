require("dotenv").config();

const mongoose = require("mongoose");
const Payment = require("../src/models/Payment");
const PaymentAllocation = require("../src/models/PaymentAllocation");
const {
  decimalOrNull,
  decimalToApi,
  divide,
  equalsWithin,
  isPositive,
  normalizeCurrency
} = require("../src/utils/money");
const {
  normalizeDpoPayment,
  normalizePaypalPayment,
  normalizePesapalPayment
} = require("../src/services/payments/providerNormalization");

const write = process.argv.includes("--write");
const batchArg = process.argv.find((argument) => argument.startsWith("--batch-size="));
const batchSize = Math.max(10, Math.min(1000, Number(batchArg?.split("=")[1] || 200)));

const stats = {
  mode: write ? "write" : "dry-run",
  scanned: 0,
  unchanged: 0,
  planned: 0,
  updated: 0,
  allocationsPlanned: 0,
  allocationsApplied: 0,
  manualReview: 0,
  invalidLegacyMoney: 0,
  errors: 0,
  duplicateAttemptIds: 0,
  duplicateProviderTransactions: 0
};

const rawResponse = (payment) =>
  payment.rawResponse || payment.providerResponse?.response || payment.providerResponse || {};

const normalizeHistoricalPayment = (payment) => {
  const provider = String(payment.provider || "").toLowerCase();
  const raw = rawResponse(payment);
  if (provider === "pesapal") {
    return normalizePesapalPayment({
      raw,
      isPaid: payment.status === "paid",
      amount: raw.amount_paid ?? raw.amount,
      currency: raw.currency ?? raw.currency_code,
      merchantReference: raw.merchant_reference || payment.merchantReference,
      providerOrderTrackingId: raw.order_tracking_id || payment.orderTrackingId || payment.providerTransactionId,
      confirmationCode: raw.confirmation_code || payment.confirmationCode,
      status: raw.payment_status_description || raw.payment_status || payment.providerStatus
    });
  }
  if (provider === "paypal") {
    return normalizePaypalPayment({
      raw,
      isPaid: payment.status === "paid",
      orderId: payment.paypalOrderId || payment.orderTrackingId,
      captureId: payment.paypalCaptureId || payment.providerTransactionId
    });
  }
  if (provider === "dpo") {
    return normalizeDpoPayment({
      ...raw,
      isPaid: payment.status === "paid",
      transactionToken: raw.transactionToken || payment.dpoTransactionToken || payment.providerTransactionId,
      transactionRef: raw.transactionRef || payment.dpoTransactionRef || payment.merchantReference
    });
  }
  return null;
};

const buildBackfill = (payment) => {
  const set = {};
  const orderAmount = decimalToApi(payment.orderAmount) || String(payment.amount ?? "");
  const orderCurrency = normalizeCurrency(payment.orderCurrency || payment.currency);
  if (!orderAmount || !isPositive(orderAmount) || !orderCurrency) {
    stats.invalidLegacyMoney += 1;
    return {
      set: {
        verificationStatus: "manual_review",
        verificationReason: "Legacy order amount or currency could not be normalized safely",
        accountingAllocationStatus: "blocked",
        "anomaly.flagged": true,
        "anomaly.code": "LEGACY_MONEY_INVALID",
        "anomaly.message": "Legacy payment requires financial review"
      },
      allocate: false,
      review: true
    };
  }

  if (!payment.orderAmount) set.orderAmount = decimalOrNull(orderAmount);
  if (!payment.orderCurrency) set.orderCurrency = orderCurrency;
  if (!payment.attemptId) set.attemptId = payment.intentId || `legacy-${payment._id}`;
  if (!payment.attemptSnapshot?.attemptId) {
    set.attemptSnapshot = {
      attemptId: payment.intentId || `legacy-${payment._id}`,
      merchantReference: payment.merchantReference || payment.bookingReference,
      provider: payment.provider,
      orderAmount: decimalOrNull(orderAmount),
      orderCurrency,
      createdAt: payment.createdAt,
      status: payment.status || "initiated"
    };
  }

  if (payment.status !== "paid") {
    if (!payment.paymentStatus) set.paymentStatus = payment.status || "pending";
    if (!payment.verificationStatus) set.verificationStatus = "pending";
    if (!payment.accountingAllocationStatus) set.accountingAllocationStatus = "pending";
    return { set, allocate: false, review: false };
  }

  const normalized = normalizeHistoricalPayment(payment);
  const provider = String(payment.provider || "").toLowerCase();
  const chargedAmount = normalized?.chargedAmount;
  const chargedCurrency = normalizeCurrency(normalized?.chargedCurrency);
  const providerReference = normalized?.providerTransactionId;
  const confirmationReference = normalized?.confirmationOrCaptureReference;
  const expectedProviderReference = String(
    payment.orderTrackingId || payment.providerTransactionId || payment.dpoTransactionToken || ""
  );
  const referenceMatches = Boolean(
    providerReference && expectedProviderReference && providerReference === expectedProviderReference
  );
  const hasConfirmation = provider === "dpo"
    ? Boolean(confirmationReference)
    : Boolean(confirmationReference && referenceMatches);
  const validProviderMoney = Boolean(chargedAmount && chargedCurrency && isPositive(chargedAmount));
  const sameCurrencyMismatch = validProviderMoney && chargedCurrency === orderCurrency && !equalsWithin(chargedAmount, orderAmount);
  const paypalCurrencyInvalid = provider === "paypal" && chargedCurrency !== "USD";
  const canVerify = Boolean(
    normalized?.isProviderPaid && validProviderMoney && hasConfirmation && !sameCurrencyMismatch && !paypalCurrencyInvalid
  );

  set.paymentStatus = "paid";
  set.providerStatus = normalized?.providerStatus || payment.providerStatus || "PAID";
  set.paymentMethod = normalized?.paymentMethod || payment.paymentMethod || "";
  if (providerReference) set.providerTransactionId = providerReference;
  if (confirmationReference) set.confirmationCode = confirmationReference;
  if (validProviderMoney) {
    set.chargedAmount = decimalOrNull(chargedAmount);
    set.chargedCurrency = chargedCurrency;
  }
  if (canVerify) {
    const converted = chargedCurrency !== orderCurrency;
    set.accountingAmount = decimalOrNull(orderAmount);
    set.accountingCurrency = orderCurrency;
    set.fxRate = converted ? decimalOrNull(divide(chargedAmount, orderAmount)) : null;
    set.fxSourceCurrency = converted ? orderCurrency : "";
    set.fxTargetCurrency = converted ? chargedCurrency : "";
    set.fxSource = converted ? `${provider}_historical_provider_response` : "none";
    set.verificationStatus = "verified";
    set.verificationReason = "Backfilled from an authoritative historical provider response";
    set.accountingAllocationStatus = "pending";
    return { set, allocate: true, review: false };
  }

  set.verificationStatus = sameCurrencyMismatch ? "amount_mismatch" : "manual_review";
  set.verificationReason = sameCurrencyMismatch
    ? "Historical provider amount does not match the immutable same-currency order"
    : "Historical provider response is incomplete or cannot be matched safely";
  set.accountingAllocationStatus = "blocked";
  set["anomaly.flagged"] = true;
  set["anomaly.code"] = sameCurrencyMismatch ? "HISTORICAL_AMOUNT_MISMATCH" : "HISTORICAL_PROVIDER_EVIDENCE_INCOMPLETE";
  set["anomaly.message"] = set.verificationReason;
  return { set, allocate: false, review: true };
};

const countDuplicateKeys = async (field) => {
  const rows = await Payment.aggregate([
    { $match: { [field]: { $type: "string", $gt: "" } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "count" }
  ]);
  return rows[0]?.count || 0;
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  stats.duplicateAttemptIds = await countDuplicateKeys("attemptId");
  stats.duplicateProviderTransactions = await countDuplicateKeys("providerTransactionId");

  let lastId = null;
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const rows = await Payment.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!rows.length) break;
    for (const payment of rows) {
      stats.scanned += 1;
      try {
        const result = buildBackfill(payment);
        if (!Object.keys(result.set).length) {
          stats.unchanged += 1;
          continue;
        }
        stats.planned += 1;
        if (result.review) stats.manualReview += 1;
        if (result.allocate) stats.allocationsPlanned += 1;
        if (!write) continue;

        await Payment.updateOne({ _id: payment._id }, { $set: result.set });
        stats.updated += 1;
        if (result.allocate) {
          const refreshed = await Payment.findById(payment._id);
          const allocationKey = `payment:${refreshed._id}:invoice:${refreshed.bookingReference}`;
          const appliedAt = refreshed.accountingAllocatedAt || new Date();
          await PaymentAllocation.updateOne(
            { allocationKey },
            {
              $setOnInsert: {
                allocationKey,
                paymentId: refreshed._id,
                bookingReference: refreshed.bookingReference,
                amount: refreshed.accountingAmount,
                currency: refreshed.accountingCurrency,
                chargedAmount: refreshed.chargedAmount,
                chargedCurrency: refreshed.chargedCurrency,
                historicalFxRate: refreshed.fxRate,
                idempotencyKey: `migration-${refreshed.intentId || refreshed._id}`,
                metadata: { source: "multi_currency_migration" }
              },
              $set: { status: "applied", appliedAt }
            },
            { upsert: true }
          );
          await Payment.updateOne(
            { _id: refreshed._id, verificationStatus: "verified" },
            { $set: { accountingAllocationStatus: "applied", accountingAllocatedAt: appliedAt } }
          );
          stats.allocationsApplied += 1;
        }
      } catch (error) {
        stats.errors += 1;
      }
    }
    lastId = rows[rows.length - 1]._id;
  }

  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(JSON.stringify({ mode: stats.mode, error: error.message }));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

const TARGET = Object.freeze({
  paymentId: "6a66f447c29333a511bc1e9b",
  bookingReference: "ZNZ-1785131164039-3948",
  intentId: "pay_428c8f41-ffe6-4e4c-85e7-de9f1530a34a",
  orderTrackingId: "8e786ce9-49ad-484f-80de-da18418162d9"
});

const REPAIR_ID = `legacy-pesapal-verification:${TARGET.paymentId}`;
const AUDIT_ACTION = "legacy_pesapal_verification_backfilled";
const VERIFICATION_FIELDS = Object.freeze([
  "verificationStatus",
  "verificationReason",
  "providerStatus",
  "chargedAmount",
  "chargedCurrency",
  "paymentMethod",
  "confirmationCode"
]);

const numberValue = (value) => Number(value?.toString?.() ?? value);
const normalized = (value) => String(value ?? "").trim();
const currency = (value) => normalized(value).toUpperCase();
const equivalentAmount = (left, right) => {
  const a = numberValue(left);
  const b = numberValue(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
};
const isEmpty = (value) => value === null || value === undefined || value === "";

const buildPlan = ({ payment, attempts = [], booking, invoice } = {}) => {
  if (!payment || String(payment._id) !== TARGET.paymentId || payment.bookingReference !== TARGET.bookingReference) {
    throw new Error("Payment identity does not match the approved repair target.");
  }
  if (payment.intentId !== TARGET.intentId || payment.provider !== "pesapal" || payment.status !== "paid") {
    throw new Error("Only the target paid Pesapal intent is eligible.");
  }
  if (payment.accountingAllocationStatus) {
    throw new Error("Payment already has an allocation state; refusing automatic repair.");
  }

  const sameBookingAttempts = Array.isArray(attempts)
    ? attempts.filter((row) => row.bookingReference === TARGET.bookingReference)
    : [];
  if (sameBookingAttempts.length !== 5 ||
      !sameBookingAttempts.some((row) => String(row._id) === TARGET.paymentId) ||
      sameBookingAttempts.filter((row) => row.status === "paid").length !== 1 ||
      sameBookingAttempts.filter((row) => row.status === "failed").length !== 4) {
    throw new Error("The expected one-paid/four-failed attempt set changed; refusing repair.");
  }
  if (!booking || booking.bookingReference !== TARGET.bookingReference ||
      String(booking.bookingStatus || "").toLowerCase() !== "confirmed" ||
      String(booking.paymentStatus || "").toLowerCase() !== "paid" ||
      !booking.bokunBookingId) {
    throw new Error("Booking state no longer matches the reviewed evidence.");
  }
  if (!invoice || invoice.bookingReference !== TARGET.bookingReference ||
      String(invoice.paymentStatus || "").toLowerCase() !== "paid") {
    throw new Error("Invoice state no longer matches the reviewed evidence.");
  }

  const response = payment.providerResponse?.response || payment.rawResponse;
  const responseAmount = numberValue(response?.amount);
  const responseCurrency = currency(response?.currency);
  const trackingId = normalized(response?.order_tracking_id);
  const merchantReference = normalized(response?.merchant_reference);
  const confirmationCode = normalized(response?.confirmation_code);
  const paymentMethod = normalized(response?.payment_method);
  const completedIpn = (payment.ipnEvents || []).some((event) =>
    normalized(event.status).toUpperCase() === "COMPLETED" &&
    normalized(event.orderTrackingId) === trackingId &&
    normalized(event.merchantReference) === TARGET.bookingReference
  );
  const completedCallback = (payment.transactionHistory || []).some((event) =>
    event.event === "payment_verified" &&
    event.status === "paid" &&
    ["ipn", "callback"].includes(event.source) &&
    (normalized(event.metadata?.providerStatus).toUpperCase() === "COMPLETED" ||
      normalized(event.description).toUpperCase() === "COMPLETED")
  );

  if (String(response?.status) !== "200") throw new Error("Stored provider response status is not successful.");
  if (!trackingId || trackingId !== TARGET.orderTrackingId ||
      trackingId !== normalized(payment.providerTransactionId) || trackingId !== normalized(payment.orderTrackingId)) {
    throw new Error("Stored Pesapal tracking reference does not match the paid intent.");
  }
  if (merchantReference !== TARGET.bookingReference || !confirmationCode || !paymentMethod) {
    throw new Error("Stored Pesapal merchant, confirmation, and payment-method evidence is incomplete or mismatched.");
  }
  if (!completedIpn || !completedCallback) throw new Error("Stored completed callback/IPN evidence is required.");
    if (!responseCurrency || responseCurrency !== "USD" || responseCurrency !== currency(payment.currency) ||
      !equivalentAmount(responseAmount, payment.amount) ||
      !equivalentAmount(responseAmount, payment.amountPaid) ||
      !equivalentAmount(responseAmount, payment.paidAmount) ||
      !equivalentAmount(responseAmount, booking.amount) ||
      !equivalentAmount(responseAmount, invoice.totalAmount ?? invoice.total) ||
      currency(invoice.accountingCurrency || invoice.currency) !== "USD") {
    throw new Error("Stored Pesapal amount/currency does not match the paid intent.");
  }

  const after = {
    verificationStatus: "verified",
    verificationReason: "Legacy Pesapal COMPLETED evidence matches the paid intent amount, currency, merchant reference, and tracking ID.",
    providerStatus: "COMPLETED",
    chargedAmount: responseAmount,
    chargedCurrency: responseCurrency,
    paymentMethod,
    confirmationCode
  };
  const before = Object.fromEntries(VERIFICATION_FIELDS.map((field) => [field, payment[field] ?? null]));
  const set = {};

  for (const field of VERIFICATION_FIELDS) {
    if (isEmpty(payment[field])) {
      set[field] = after[field];
    } else if (payment[field] !== after[field] &&
        !(field === "chargedAmount" && equivalentAmount(payment[field], after[field]))) {
      throw new Error(`Existing ${field} conflicts with stored provider evidence; refusing repair.`);
    }
  }

  return {
    action: Object.keys(set).length ? "would_backfill" : "already_repaired",
    target: TARGET,
    before,
    after,
    set,
    untouched: [
      "status",
      "amount",
      "amountPaid",
      "paidAmount",
      "orderAmount",
      "orderCurrency",
      "accountingAmount",
      "accountingCurrency",
      "accountingAllocationStatus",
      "invoiceStatus",
      "bokunSyncStatus",
      "booking",
      "invoice",
      "PaymentAllocation",
      "journal entries",
      "other payment attempts"
    ],
    evidence: {
      providerResponseStatus: String(response.status),
      providerStatus: "COMPLETED",
      amount: responseAmount,
      currency: responseCurrency,
      trackingReferenceMatched: true,
      merchantReferenceMatched: true,
      confirmationCodePresent: true,
      completedIpnPresent: completedIpn,
      completedCallbackPresent: completedCallback
    }
  };
};

const createLegacyPesapalVerificationRepair = ({ store, clock = () => new Date() } = {}) => {
  if (!store) throw new Error("A repair store is required.");

  const run = async ({ apply = false, approvalId = "", actorId = "", reason = "" } = {}) => {
    if (!apply) {
      const evidence = await store.readEvidence();
      return { mode: "dry-run", readOnly: true, ...buildPlan(evidence) };
    }
    if (!approvalId || !actorId || !reason) {
      throw new Error("Apply requires approvalId, actorId, and reason.");
    }

    return store.transaction(async (transaction) => {
      const evidence = await transaction.readEvidence();
      const plan = buildPlan(evidence);
      const existingAudit = await transaction.findRepairAudit(REPAIR_ID);

      if (plan.action === "already_repaired") {
        if (!existingAudit) throw new Error("Canonical fields already match, but the repair audit is missing; refusing an unaudited no-op.");
        return { mode: "apply", action: "already_applied", target: TARGET, before: plan.before, after: plan.after };
      }
      if (existingAudit) throw new Error("Repair audit exists but payment fields are incomplete; manual review is required.");

      if (existingAudit) throw new Error("Repair audit exists but payment fields are incomplete; manual review is required.");

      const matched = await transaction.compareAndSetPayment(evidence.payment, plan.set);
      if (!matched) throw new Error("Payment changed during repair; no fields were backfilled.");

      const audit = {
        actorId,
        actorRole: "admin",
        action: AUDIT_ACTION,
        entityType: "Payment",
        entityId: TARGET.paymentId,
        reference: TARGET.bookingReference,
        reason,
        before: plan.before,
        after: plan.after,
        metadata: {
          repairId: REPAIR_ID,
          approvalId,
          evidence: plan.evidence,
          fieldsChanged: Object.keys(plan.set),
          allocationChanged: false,
          accountingPostingCreated: false
        },
        createdAt: clock()
      };
      await transaction.createAudit(audit);

      return { mode: "apply", action: "applied", target: TARGET, before: plan.before, after: plan.after, auditAction: AUDIT_ACTION };
    });
  };

  return { run };
};

module.exports = {
  AUDIT_ACTION,
  REPAIR_ID,
  TARGET,
  VERIFICATION_FIELDS,
  buildPlan,
  createLegacyPesapalVerificationRepair
};
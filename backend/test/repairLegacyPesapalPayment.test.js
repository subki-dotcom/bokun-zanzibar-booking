process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/legacy-pesapal-repair-test";
process.env.JWT_SECRET ||= "legacy-pesapal-repair-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUDIT_ACTION,
  REPAIR_ID,
  TARGET,
  VERIFICATION_FIELDS,
  buildPlan,
  createLegacyPesapalVerificationRepair
} = require("../src/services/payments/legacyPesapalVerificationRepair");

const clone = (value) => structuredClone(value);

const makeEvidence = () => {
  const payment = {
    _id: TARGET.paymentId,
    bookingReference: TARGET.bookingReference,
    intentId: TARGET.intentId,
    provider: "pesapal",
    status: "paid",
    amount: 1,
    currency: "USD",
    amountPaid: 1,
    paidAmount: 1,
    providerTransactionId: TARGET.orderTrackingId,
    orderTrackingId: TARGET.orderTrackingId,
    updatedAt: new Date("2026-07-27T06:26:54.497Z"),
    verificationStatus: null,
    verificationReason: null,
    providerStatus: null,
    chargedAmount: null,
    chargedCurrency: null,
    paymentMethod: null,
    confirmationCode: null,
    accountingAllocationStatus: null,
    invoiceStatus: null,
    providerResponse: {
      stage: "get_transaction_status",
      response: {
        status: "200",
        amount: 1,
        currency: "USD",
        order_tracking_id: TARGET.orderTrackingId,
        merchant_reference: TARGET.bookingReference,
        confirmation_code: "7851324134926026004073",
        payment_method: "Visa"
      }
    },
    rawResponse: {
      status: "200",
      amount: 1,
      currency: "USD",
      order_tracking_id: TARGET.orderTrackingId,
      merchant_reference: TARGET.bookingReference,
      confirmation_code: "7851324134926026004073",
      payment_method: "Visa"
    },
    ipnEvents: [{
      source: "ipn",
      status: "COMPLETED",
      orderTrackingId: TARGET.orderTrackingId,
      merchantReference: TARGET.bookingReference
    }],
    transactionHistory: [{
      event: "payment_verified",
      status: "paid",
      source: "callback",
      description: "Completed",
      metadata: {}
    }]
  };
  return {
    payment,
    attempts: [
      payment,
      ...Array.from({ length: 4 }, (_, index) => ({
        _id: `failed-${index}`,
        bookingReference: TARGET.bookingReference,
        provider: "pesapal",
        providerTransactionId: TARGET.orderTrackingId,
        status: "failed",
        amount: 1,
        amountPaid: 0
      }))
    ],
    booking: {
      bookingReference: TARGET.bookingReference,
      bookingStatus: "CONFIRMED",
      paymentStatus: "paid",
      currency: "USD",
      amount: 1,
      bokunBookingId: "98613320"
    },
    invoice: {
      bookingReference: TARGET.bookingReference,
      paymentStatus: "paid",
      total: 1,
      amountPaid: 1,
      balanceDue: 0,
      currency: "USD",
      accountingCurrency: "USD"
    }
  };
};

const createMemoryStore = (initialEvidence, { failAudit = false, failCas = false } = {}) => {
  const state = { evidence: clone(initialEvidence), audits: [], paymentWrites: 0, auditWrites: 0 };
  const store = {
    async readEvidence() { return clone(state.evidence); },
    async transaction(work) {
      const snapshot = clone(state);
      const transaction = {
        readEvidence: async () => clone(state.evidence),
        findRepairAudit: async (repairId) => state.audits.find((audit) => audit.metadata.repairId === repairId) || null,
        compareAndSetPayment: async (expectedPayment, fields) => {
          const current = state.evidence.payment;
          if (failCas || current.updatedAt.getTime() !== expectedPayment.updatedAt.getTime()) return false;
          Object.assign(current, clone(fields));
          state.paymentWrites += 1;
          return true;
        },
        createAudit: async (audit) => {
          if (failAudit) throw new Error("audit unavailable");
          state.audits.push(clone(audit));
          state.auditWrites += 1;
        }
      };
      try {
        return await work(transaction);
      } catch (error) {
        state.evidence = snapshot.evidence;
        state.audits = snapshot.audits;
        state.paymentWrites = snapshot.paymentWrites;
        state.auditWrites = snapshot.auditWrites;
        throw error;
      }
    }
  };
  return { store, state };
};

test("repair plan accepts stored legacy Pesapal evidence and proposes only verification fields", () => {
  const evidence = makeEvidence();
  const original = clone(evidence);
  const plan = buildPlan(evidence);

  assert.equal(plan.action, "would_backfill");
  assert.deepEqual(plan.before, {
    verificationStatus: null,
    verificationReason: null,
    providerStatus: null,
    chargedAmount: null,
    chargedCurrency: null,
    paymentMethod: null,
    confirmationCode: null
  });
  assert.deepEqual(Object.keys(plan.set).sort(), [...VERIFICATION_FIELDS].sort());
  assert.deepEqual(plan.after, {
    verificationStatus: "verified",
    verificationReason: "Legacy Pesapal COMPLETED evidence matches the paid intent amount, currency, merchant reference, and tracking ID.",
    providerStatus: "COMPLETED",
    chargedAmount: 1,
    chargedCurrency: "USD",
    paymentMethod: "Visa",
    confirmationCode: "7851324134926026004073"
  });
  assert.deepEqual(evidence, original);
  assert.ok(plan.untouched.includes("accountingAllocationStatus"));
  assert.ok(!Object.hasOwn(plan.set, "accountingAllocationStatus"));
});

test("repair plan requires the exact one-paid/four-failed attempts and booking/invoice agreement", () => {
  const attemptsChanged = makeEvidence();
  attemptsChanged.attempts.pop();
  assert.throws(() => buildPlan(attemptsChanged), /attempt set changed/);

  const invoiceChanged = makeEvidence();
  invoiceChanged.invoice.total = 2;
  assert.throws(() => buildPlan(invoiceChanged), /amount\/currency does not match/);

  const bookingChanged = makeEvidence();
  bookingChanged.booking.bookingStatus = "pending";
  assert.throws(() => buildPlan(bookingChanged), /Booking state no longer matches/);
});

test("repair plan fails closed on provider mismatch, non-target payment, or conflicting canonical fields", () => {
  const amountChanged = makeEvidence();
  amountChanged.payment.providerResponse.response.amount = 2;
  assert.throws(() => buildPlan(amountChanged), /amount\/currency does not match/);

  const trackingChanged = makeEvidence();
  trackingChanged.payment.providerResponse.response.order_tracking_id = "other";
  assert.throws(() => buildPlan(trackingChanged), /tracking reference does not match/);

  const nonPaid = makeEvidence();
  nonPaid.payment.status = "failed";
  assert.throws(() => buildPlan(nonPaid), /Only the target paid Pesapal intent/);

  const conflicting = makeEvidence();
  conflicting.payment.verificationStatus = "manual_review";
  assert.throws(() => buildPlan(conflicting), /verificationStatus conflicts/);
});

test("dry-run is read-only; apply writes a single whitelist update and one immutable audit", async () => {
  const { store, state } = createMemoryStore(makeEvidence());
  const repair = createLegacyPesapalVerificationRepair({ store, clock: () => new Date("2026-10-03T12:00:00.000Z") });
  const dryRun = await repair.run();
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(state.paymentWrites, 0);
  assert.equal(state.auditWrites, 0);

  const protectedBefore = Object.fromEntries([
    "status", "amount", "amountPaid", "paidAmount", "accountingAllocationStatus", "invoiceStatus"
  ].map((field) => [field, state.evidence.payment[field]]));
  const result = await repair.run({ apply: true, approvalId: "CASE-42", actorId: "admin-test", reason: "Approved repair test" });

  assert.equal(result.action, "applied");
  assert.equal(state.paymentWrites, 1);
  assert.equal(state.auditWrites, 1);
  assert.deepEqual(Object.fromEntries(Object.keys(protectedBefore).map((field) => [field, state.evidence.payment[field]])), protectedBefore);
  assert.deepEqual(Object.keys(state.audits[0].after).sort(), [...VERIFICATION_FIELDS].sort());
  assert.equal(state.audits[0].action, AUDIT_ACTION);
  assert.equal(state.audits[0].metadata.repairId, REPAIR_ID);
  assert.equal(state.audits[0].metadata.approvalId, "CASE-42");
});

test("apply replay is idempotent and does not create another payment write or audit", async () => {
  const { store, state } = createMemoryStore(makeEvidence());
  const repair = createLegacyPesapalVerificationRepair({ store });
  await repair.run({ apply: true, approvalId: "CASE-42", actorId: "admin-test", reason: "Approved repair test" });
  const replay = await repair.run({ apply: true, approvalId: "CASE-42", actorId: "admin-test", reason: "Approved repair test" });

  assert.equal(replay.action, "already_applied");
  assert.equal(state.paymentWrites, 1);
  assert.equal(state.auditWrites, 1);
});

test("approval, audit, and compare-and-set failures leave payment unchanged", async () => {
  const noApproval = createMemoryStore(makeEvidence());
  const noApprovalRepair = createLegacyPesapalVerificationRepair({ store: noApproval.store });
  await assert.rejects(() => noApprovalRepair.run({ apply: true }), /requires approvalId, actorId, and reason/);
  assert.equal(noApproval.state.paymentWrites, 0);

  const auditFailure = createMemoryStore(makeEvidence(), { failAudit: true });
  const auditRepair = createLegacyPesapalVerificationRepair({ store: auditFailure.store });
  await assert.rejects(() => auditRepair.run({ apply: true, approvalId: "CASE-AUDIT", actorId: "admin-test", reason: "test" }), /audit unavailable/);
  assert.equal(auditFailure.state.paymentWrites, 0);
  assert.equal(auditFailure.state.auditWrites, 0);
  assert.equal(auditFailure.state.evidence.payment.verificationStatus, null);

  const casFailure = createMemoryStore(makeEvidence(), { failCas: true });
  const casRepair = createLegacyPesapalVerificationRepair({ store: casFailure.store });
  await assert.rejects(() => casRepair.run({ apply: true, approvalId: "CASE-CAS", actorId: "admin-test", reason: "test" }), /changed during repair/);
  assert.equal(casFailure.state.paymentWrites, 0);
  assert.equal(casFailure.state.auditWrites, 0);
});

test("CLI defaults to dry-run and refuses apply without explicit confirmation and approval ID", async () => {
  const script = require("../scripts/repair-legacy-pesapal-payment");
  assert.deepEqual(script.parseArgs([]), { apply: false, confirm: false, approvalId: "", actorId: "", reason: "" });
  await assert.rejects(() => script.main(["--apply"]), /--confirm is required/);
  await assert.rejects(() => script.main(["--apply", "--confirm"]), /--approval-id is required/);
  await assert.rejects(() => script.main(["--apply", "--confirm", "--approval-id", "CASE-1"]), /--actor-id is required/);
  await assert.rejects(() => script.main(["--apply", "--confirm", "--approval-id", "CASE-1", "--actor-id", "admin-1"]), /--reason is required/);
  assert.deepEqual(script.parseArgs(["--apply", "--confirm", "--approval-id", "CASE-1", "--actor-id", "admin-1", "--reason", "approved legacy verification"]), {
    apply: true,
    confirm: true,
    approvalId: "CASE-1",
    actorId: "admin-1",
    reason: "approved legacy verification"
  });
});

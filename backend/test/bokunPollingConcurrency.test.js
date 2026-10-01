process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-polling-concurrency-test";
process.env.JWT_SECRET ||= "bokun-polling-concurrency-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { __testables } = require("../src/services/webhooks");

const clone = (value) => structuredClone(value);

test("concurrent Bokun writes reload on version conflict and preserve newer payment/accounting evidence", async () => {
  const state = {
    _id: "booking-1",
    __v: 0,
    bookingReference: "REF-1",
    bookingStatus: "pending",
    rawBokunResponse: { status: "old" },
    bokunStatus: { raw: "old", normalized: "pending" },
    bokunImport: { lastSyncSource: "old" },
    syncState: { lastBokunSyncSource: "old" },
    paymentStatus: "pending",
    bokunFinancialEvidence: { status: "NEEDS_REVIEW", evidenceHash: "old" },
    estimatedCostSnapshot: { total: 40, source: "accounting" }
  };
  let initialWrites = 0;
  let releaseInitialWrites;
  const initialWriteBarrier = new Promise((resolve) => { releaseInitialWrites = resolve; });
  const updates = [];
  const BookingModel = {
    findById: async () => {
      const document = clone(state);
      document.toObject = function toObject() {
        const plain = { ...this };
        delete plain.toObject;
        delete plain.unmarkModified;
        return clone(plain);
      };
      document.unmarkModified = () => {};
      return document;
    },
    updateOne: async (filter, update) => {
      updates.push(clone(update));
      if (initialWrites < 2) {
        initialWrites += 1;
        if (initialWrites === 2) {
          state.paymentStatus = "paid";
          state.bokunFinancialEvidence = { status: "VERIFIED", evidenceHash: "new-payment-evidence" };
          state.estimatedCostSnapshot = { total: 55, source: "new-accounting-evidence" };
          state.__v += 1;
          releaseInitialWrites();
        }
        await initialWriteBarrier;
      }

      if (state.__v !== filter.__v) return { matchedCount: 0 };
      Object.assign(state, clone(update.$set));
      state.__v += update.$inc.__v;
      return { matchedCount: 1 };
    }
  };

  const [first, second] = await Promise.all([
    __testables.updateBokunFieldsWithRetry({
      bookingId: state._id,
      BookingModel,
      mutate: (booking) => {
        booking.bokunStatus = { raw: "CONFIRMED-A", normalized: "confirmed" };
        booking.syncState = { ...booking.syncState, lastBokunSyncSource: "poll-A" };
      }
    }),
    __testables.updateBokunFieldsWithRetry({
      bookingId: state._id,
      BookingModel,
      mutate: (booking) => {
        booking.rawBokunResponse = { status: "CONFIRMED-B" };
        booking.bokunImport = { ...booking.bokunImport, lastSyncSource: "poll-B" };
      }
    })
  ]);

  assert.ok(first.bookingDoc);
  assert.ok(second.bookingDoc);
  assert.equal(state.__v, 3);
  assert.equal(state.bokunStatus.raw, "CONFIRMED-A");
  assert.equal(state.rawBokunResponse.status, "CONFIRMED-B");
  assert.equal(state.syncState.lastBokunSyncSource, "poll-A");
  assert.equal(state.bokunImport.lastSyncSource, "poll-B");
  assert.equal(state.paymentStatus, "paid");
  assert.deepEqual(state.bokunFinancialEvidence, { status: "VERIFIED", evidenceHash: "new-payment-evidence" });
  assert.deepEqual(state.estimatedCostSnapshot, { total: 55, source: "new-accounting-evidence" });
  for (const update of updates) {
    assert.equal("bokunFinancialEvidence" in update.$set, false);
    assert.equal("estimatedCostSnapshot" in update.$set, false);
    assert.equal("paymentStatus" in update.$set, false);
  }
});

test("a failed polling booking does not stop later bookings in the same batch", async () => {
  const processed = [];
  const results = await __testables.processCandidatesIndependently({
    candidates: [{ _id: "failed", bookingReference: "REF-FAIL" }, { _id: "next", bookingReference: "REF-NEXT" }],
    processCandidate: async (booking) => {
      if (booking._id === "failed") throw new Error("version conflict");
      processed.push(booking._id);
      return { updated: true, bookingId: booking._id };
    }
  });

  assert.deepEqual(processed, ["next"]);
  assert.equal(results[0].failed, true);
  assert.match(results[0].error, /version conflict/);
  assert.equal(results[1].updated, true);
});
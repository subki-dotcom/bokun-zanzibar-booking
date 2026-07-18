const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/finalization-policy-test";
process.env.JWT_SECRET ||= "finalization-policy-test-secret";

const { __testables } = require("../src/services/bookings");

test("retries only temporary Bokun provider failures", () => {
  const invalidRequest = __testables.extractFinalizationMetaFromError({
    code: "BOKUN_REQUEST_FAILED",
    statusCode: 400,
    message: "Missing startTimeId (Field: startTimeId)"
  });
  const timeout = __testables.extractFinalizationMetaFromError({
    code: "BOKUN_REQUEST_FAILED",
    statusCode: 504,
    message: "Gateway timeout"
  });
  const rateLimited = __testables.extractFinalizationMetaFromError({
    code: "BOKUN_REQUEST_FAILED",
    statusCode: 429,
    message: "Too many requests"
  });

  assert.equal(invalidRequest.isPendingRetry, false);
  assert.equal(timeout.isPendingRetry, true);
  assert.equal(rateLimited.isPendingRetry, true);
});

test("uses the 1m, 5m, 15m, then hourly retry schedule", () => {
  const now = Date.now();
  const waits = [1, 2, 3, 4].map((attempt) =>
    Date.parse(__testables.calculateNextFinalizationRetryAt(attempt)) - now
  );

  assert.ok(waits[0] >= 59_000 && waits[0] <= 61_000);
  assert.ok(waits[1] >= 299_000 && waits[1] <= 301_000);
  assert.ok(waits[2] >= 899_000 && waits[2] <= 901_000);
  assert.ok(waits[3] >= 3_599_000 && waits[3] <= 3_601_000);
});

test("automatic reconciliation skips permanent failed finalizations", () => {
  const query = __testables.buildPendingFinalizationQuery({ nowIso: "2026-07-18T12:00:00.000Z" });
  const statusClause = query.$and.find((clause) => Array.isArray(clause.$or));
  const statuses = statusClause.$or
    .map((entry) => entry["pendingCheckout.finalization.status"])
    .filter((status) => typeof status === "string");

  assert.equal(statuses.includes("failed"), false);
  assert.deepEqual(statuses.sort(), ["idle", "pending_retry"]);
});

test("only reactivates legacy Pesapal verification failures after a fresh verification", () => {
  assert.equal(
    __testables.isRecoverableLegacyPesapalVerificationFailure({
      paymentStatus: "paid",
      pendingCheckout: {
        checkoutPayload: { productId: "activity-1" },
        finalization: {
          status: "failed",
          lastError: { code: "PESAPAL_VERIFIED_AMOUNT_MISMATCH" }
        }
      }
    }),
    true
  );

  assert.equal(
    __testables.isRecoverableLegacyPesapalVerificationFailure({
      paymentStatus: "paid",
      pendingCheckout: {
        checkoutPayload: { productId: "activity-1" },
        finalization: {
          status: "failed",
          lastError: { code: "BOKUN_REQUEST_FAILED" }
        }
      }
    }),
    false
  );

  assert.equal(
    __testables.isRecoverableLegacyPesapalVerificationFailure({
      paymentStatus: "paid",
      bokunBookingId: "123456",
      pendingCheckout: {
        checkoutPayload: { productId: "activity-1" },
        finalization: {
          status: "failed",
          lastError: { code: "PESAPAL_VERIFIED_CURRENCY_MISMATCH" }
        }
      }
    }),
    false
  );
});

test("restores saved customer details and answers for a legacy finalization", () => {
  const customer = __testables.mergeCustomerDetailsForFinalization({
    bookingCustomer: {
      firstName: "Asha",
      email: "asha@example.com",
      hotelName: "Tembo House Hotel"
    },
    checkoutCustomer: {
      firstName: "Asha",
      email: "",
      hotelName: ""
    }
  });
  const questions = __testables.mergeBookingQuestionsForFinalization({
    bookingQuestions: [
      { questionId: "pickup", scope: "pickup", answer: "Tembo House Hotel" },
      { questionId: "flight", scope: "booking", answer: "KQ 488" }
    ],
    checkoutQuestions: [
      { questionId: "pickup", scope: "pickup", answer: "" },
      { questionId: "flight", scope: "booking", answer: "KQ 488" }
    ]
  });

  assert.equal(customer.email, "asha@example.com");
  assert.equal(customer.hotelName, "Tembo House Hotel");
  assert.deepEqual(
    questions.map((question) => [question.questionId, question.answer]),
    [
      ["pickup", "Tembo House Hotel"],
      ["flight", "KQ 488"]
    ]
  );
});

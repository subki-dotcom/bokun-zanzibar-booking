import test from "node:test";
import assert from "node:assert/strict";

import { getMissingRequiredQuestionLabels } from "../src/utils/bookingQuestions.js";

const questions = [
  { questionId: "1", label: "Arrival Airline", scope: "booking", required: true },
  { questionId: "2", label: "Arrival Flight No", scope: "booking", required: true },
  { questionId: "3", label: "Phone number", scope: "booking", required: true }
];

test("blocks every checkout action until required Bokun answers are complete", () => {
  const missing = getMissingRequiredQuestionLabels({
    questions,
    answers: [{ questionId: "1", scope: "booking", answer: "KLM" }],
    customer: { phone: "+255700000000" }
  });

  assert.deepEqual(missing, ["Arrival Flight No"]);
});

test("accepts completed supplier questions and customer-managed answers", () => {
  const missing = getMissingRequiredQuestionLabels({
    questions,
    answers: [
      { questionId: "1", scope: "booking", answer: "KLM" },
      { questionId: "2", scope: "booking", answer: "KL 515" }
    ],
    customer: { phone: "+255700000000" }
  });

  assert.deepEqual(missing, []);
});

test("does not ask the customer for Bokun notification settings", () => {
  const missing = getMissingRequiredQuestionLabels({
    questions: [
      {
        questionId: "sendNotificationToMainContact",
        label: "Send notification to main contact",
        scope: "booking",
        type: "boolean",
        required: true
      }
    ],
    answers: [],
    customer: {}
  });

  assert.deepEqual(missing, []);
});

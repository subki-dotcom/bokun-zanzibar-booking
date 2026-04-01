export const STEP_IDS = {
  TRIP_DETAILS: "trip_details",
  EXTRAS: "extras",
  QUESTIONS: "questions",
  CUSTOMER: "customer",
  REVIEW: "review",
  CONFIRMATION: "confirmation"
};

const buildBaseSteps = ({ hasExtras = false, hasQuestions = false, hasConfirmation = false } = {}) => {
  const steps = [
    { id: STEP_IDS.TRIP_DETAILS, label: "Trip Details", locked: true, alwaysComplete: true }
  ];

  if (hasExtras) {
    steps.push({ id: STEP_IDS.EXTRAS, label: "Extras" });
  }

  if (hasQuestions) {
    steps.push({ id: STEP_IDS.QUESTIONS, label: "Booking Questions" });
  }

  steps.push({ id: STEP_IDS.CUSTOMER, label: "Customer Details" });
  steps.push({ id: STEP_IDS.REVIEW, label: "Review & Confirm" });

  if (hasConfirmation) {
    steps.push({ id: STEP_IDS.CONFIRMATION, label: "Confirmation", locked: true });
  }

  return steps;
};

export const resolveFirstActionableStepId = ({
  hasExtras = false,
  hasQuestions = false
} = {}) => {
  if (hasExtras) {
    return STEP_IDS.EXTRAS;
  }

  if (hasQuestions) {
    return STEP_IDS.QUESTIONS;
  }

  return STEP_IDS.CUSTOMER;
};

export const buildSmartCheckoutSteps = ({
  hasExtras = false,
  hasQuestions = false,
  hasConfirmation = false,
  currentStepId = STEP_IDS.CUSTOMER,
  completedStepIds = []
} = {}) => {
  const baseSteps = buildBaseSteps({ hasExtras, hasQuestions, hasConfirmation });
  const completedSet = new Set([STEP_IDS.TRIP_DETAILS, ...(completedStepIds || [])]);
  const currentIndex = baseSteps.findIndex((step) => step.id === currentStepId);

  return baseSteps.map((step, index) => {
    const isCurrent = step.id === currentStepId;
    const isCompleted =
      step.alwaysComplete ||
      completedSet.has(step.id) ||
      (currentIndex > -1 && index < currentIndex);

    return {
      ...step,
      index: index + 1,
      current: isCurrent,
      completed: isCompleted && !isCurrent,
      pending: !isCurrent && !isCompleted
    };
  });
};

export const resolveNextStepId = (steps = [], currentStepId = "") => {
  const currentIndex = (steps || []).findIndex((step) => step.id === currentStepId);
  if (currentIndex < 0) {
    return currentStepId;
  }

  return steps[currentIndex + 1]?.id || currentStepId;
};

export const resolvePreviousStepId = (steps = [], currentStepId = "") => {
  const currentIndex = (steps || []).findIndex((step) => step.id === currentStepId);
  if (currentIndex <= 0) {
    return currentStepId;
  }

  return steps[currentIndex - 1]?.id || currentStepId;
};


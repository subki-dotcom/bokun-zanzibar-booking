import { BsCheck2 } from "react-icons/bs";
import { BOOKING_STEPS } from "../../utils/constants";

const normalizeLegacySteps = (currentStep = 1) =>
  BOOKING_STEPS.map((label, index) => {
    const stepNumber = index + 1;
    const current = stepNumber === currentStep;
    const completed = stepNumber < currentStep;

    return {
      id: `legacy_${stepNumber}`,
      label,
      index: stepNumber,
      current,
      completed,
      pending: !current && !completed
    };
  });

const compactLabel = (label = "") => {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("trip")) return "Trip";
  if (normalized.includes("customer")) return "Customer";
  if (normalized.includes("review")) return "Review";
  return label;
};

const BookingStepper = ({ currentStep = 1, steps = null }) => {
  const normalizedSteps =
    Array.isArray(steps) && steps.length
      ? steps.map((step, index) => ({
          ...step,
          index: Number(step.index || index + 1)
        }))
      : normalizeLegacySteps(currentStep);

  return (
    <div className="smart-stepper-track">
      <span className="smart-stepper-line" aria-hidden="true" />
      {normalizedSteps.map((step) => (
        <div
          className={`smart-step-item ${step.current ? "is-current" : ""} ${step.completed ? "is-completed" : ""}`.trim()}
          key={step.id}
        >
          <span className="smart-step-dot">
            {step.completed ? <BsCheck2 /> : step.index}
          </span>
          <span className="smart-step-label" aria-label={step.label}>
            <span className="smart-step-label-full">{step.label}</span>
            <span className="smart-step-label-short" aria-hidden="true">{compactLabel(step.label)}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

export default BookingStepper;

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
      {normalizedSteps.map((step, index) => (
        <div
          className={`smart-step-item ${step.current ? "is-current" : ""} ${step.completed ? "is-completed" : ""}`.trim()}
          key={step.id}
        >
          <span className="smart-step-dot">
            {step.completed ? <BsCheck2 /> : step.index}
          </span>
          <span className="smart-step-label">{step.label}</span>
          {index < normalizedSteps.length - 1 ? <span className="smart-step-connector" /> : null}
        </div>
      ))}
    </div>
  );
};

export default BookingStepper;

import Card from "react-bootstrap/Card";
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
    <Card className="surface-card smart-stepper-card mb-3">
      <Card.Body className="py-3">
        <div className="smart-stepper-track">
          {normalizedSteps.map((step) => (
            <div
              className={`smart-step-item ${step.current ? "is-current" : ""} ${step.completed ? "is-completed" : ""}`.trim()}
              key={step.id}
            >
              <span className="smart-step-dot">
                {step.completed ? <BsCheck2 /> : step.index}
              </span>
              <span className="smart-step-label">{step.label}</span>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

export default BookingStepper;


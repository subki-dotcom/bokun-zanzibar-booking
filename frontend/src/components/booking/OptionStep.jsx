import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";

const OptionStep = ({ options = [], selectedOptionId, onSelect, onNext }) => {
  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Select Option</h4>
        <div className="d-grid gap-3">
          {options.map((option) => {
            const optionId = String(option.bokunOptionId || "");
            const selected = optionId === String(selectedOptionId || "");

            return (
              <button
                key={optionId}
                type="button"
                className={`btn text-start p-3 ${selected ? "btn-info" : "btn-outline-secondary"}`}
                onClick={() => onSelect(option)}
              >
                <div className="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <h6 className="mb-1">{option.name}</h6>
                    <small>{option.description}</small>
                  </div>
                  <strong>{option.pricingSummary || "Pricing on request"}</strong>
                </div>
              </button>
            );
          })}
        </div>

        <div className="d-flex justify-content-end mt-4">
          <Button disabled={!selectedOptionId} className="premium-btn text-white" onClick={onNext}>
            Continue
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default OptionStep;

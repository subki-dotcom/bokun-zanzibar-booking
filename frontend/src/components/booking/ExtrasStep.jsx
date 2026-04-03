import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { BsGift } from "react-icons/bs";

const ExtrasStep = ({
  extras = [],
  availableExtras = [],
  onToggleExtra,
  onChangeQuantity,
  onBack,
  onNext,
  loading = false
}) => {
  if (!availableExtras.length) {
    return (
      <Card className="surface-card smart-step-card">
        <Card.Body>
          <h4 className="mb-2">Optional extras</h4>
          <p className="text-muted mb-3">
            This trip has no optional extras. Continue to the next step.
          </p>
          <div className="checkout-action-row">
            <Button variant="outline-secondary" onClick={onBack} disabled={loading}>
              Back
            </Button>
            <Button className="premium-btn text-white" onClick={onNext} disabled={loading}>
              Continue
            </Button>
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="surface-card smart-step-card">
      <Card.Body>
        <h4 className="mb-2">Optional extras</h4>
        <p className="text-muted mb-3">
          Add optional services for this booking. Final total updates from live quote.
        </p>

        <div className="d-grid gap-3">
          {availableExtras.map((extra) => {
            const code = String(extra.code || "");
            const selected = extras.find((item) => String(item.code) === code);
            const checked = Boolean(selected);
            const maxQuantity = Math.max(1, Number(extra.maxQuantity || 1));
            const amount = Number(extra.amount || 0);
            const currency = extra.currency || "USD";

            return (
              <div className={`smart-extra-card ${checked ? "is-selected" : ""}`.trim()} key={code}>
                <Form.Check
                  type="checkbox"
                  id={`extra-${code}`}
                  checked={checked}
                  onChange={() => onToggleExtra?.(extra)}
                  label={
                    <span className="fw-semibold">
                      <BsGift className="me-2" />
                      {extra.label}
                    </span>
                  }
                />
                <div className="smart-extra-meta mt-2">
                  <span className="text-muted">{extra.description || "Optional add-on"}</span>
                  <strong>
                    {currency} {amount.toFixed(2)}
                  </strong>
                </div>

                {checked ? (
                  <div className="smart-extra-qty mt-2">
                    <Form.Label className="mb-1">Quantity</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      max={maxQuantity}
                      value={selected?.quantity || 1}
                      onChange={(event) =>
                        onChangeQuantity?.(code, Number(event.target.value || 1), maxQuantity)
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="checkout-action-row mt-4">
          <Button variant="outline-secondary" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext} disabled={loading}>
            {loading ? "Refreshing quote..." : "Continue"}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ExtrasStep;

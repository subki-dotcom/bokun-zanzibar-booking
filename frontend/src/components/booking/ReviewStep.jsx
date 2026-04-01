import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import { formatCurrency } from "../../utils/formatters";

const ReviewStep = ({ flowState, submitting, onBack, onConfirm }) => {
  const { option, travelDate, startTime, pax, priceCategoryParticipants, priceCatalog, extras, customer, answers, quote } = flowState;
  const categoryPaxRows = (priceCategoryParticipants || []).filter((row) => Number(row.quantity || 0) > 0);

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Review & Confirm</h4>

        <div className="row g-3">
          <div className="col-md-6">
            <h6>Trip details</h6>
            <p className="mb-1">Option: {option?.name}</p>
            <p className="mb-1">Catalog: {priceCatalog?.title || "Default"}</p>
            <p className="mb-1">Date: {travelDate}</p>
            <p className="mb-1">Time: {startTime}</p>
            {categoryPaxRows.length ? (
              categoryPaxRows.map((row) => (
                <p key={row.categoryId} className="mb-1">
                  {row.title}: {row.quantity}
                </p>
              ))
            ) : (
              <p className="mb-0">
                Pax: A:{pax.adults} C:{pax.children} I:{pax.infants}
              </p>
            )}
          </div>
          <div className="col-md-6">
            <h6>Customer</h6>
            <p className="mb-1">
              {customer.firstName} {customer.lastName}
            </p>
            <p className="mb-1">{customer.email}</p>
            <p className="mb-0">{customer.phone}</p>
          </div>
          <div className="col-md-6">
            <h6>Extras</h6>
            {extras.length ? (
              extras.map((extra) => (
                <p key={extra.code} className="mb-1">
                  {extra.label} x{extra.quantity}
                </p>
              ))
            ) : (
              <p className="mb-0 text-muted">No extras selected</p>
            )}
          </div>
          <div className="col-md-6">
            <h6>Booking answers</h6>
            {answers.length ? (
              answers.slice(0, 6).map((answer, index) => (
                <p className="mb-1" key={`${answer.questionId}-${index}`}>
                  {answer.label}: {String(answer.answer)}
                </p>
              ))
            ) : (
              <p className="mb-0 text-muted">No answers provided</p>
            )}
          </div>
        </div>

        <hr />

        <div className="d-flex justify-content-between align-items-center mb-3">
          <strong>Total payable</strong>
          <strong>{formatCurrency(quote?.pricing?.finalPayable, quote?.pricing?.currency)}</strong>
        </div>

        <div className="d-flex justify-content-between">
          <Button variant="outline-secondary" onClick={onBack} disabled={submitting}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onConfirm} disabled={submitting || !quote?.quoteToken}>
            {submitting ? "Creating Booking..." : "Confirm Booking"}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ReviewStep;

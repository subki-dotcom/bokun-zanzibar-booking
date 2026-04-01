import Card from "react-bootstrap/Card";

const toDisplayAnswer = (value) => {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
};

const BookingAnswersSummary = ({ answers = [] }) => {
  const rows = (answers || []).filter((row) => {
    const text = toDisplayAnswer(row?.answer).trim();
    return text.length > 0;
  });

  return (
    <Card className="surface-card review-summary-card">
      <Card.Body>
        <div className="review-block-label">Booking Answers</div>

        {rows.length ? (
          <div className="review-compact-list">
            {rows.map((row, index) => (
              <div className="review-compact-row" key={`${row.questionId || "q"}-${index}`}>
                <span className="review-compact-key">
                  {row.label || "Answer"}
                  {row.scope === "passenger" && Number.isFinite(Number(row.passengerIndex))
                    ? ` (Passenger ${Number(row.passengerIndex) + 1})`
                    : ""}
                </span>
                <strong className="review-compact-value">{toDisplayAnswer(row.answer) || "-"}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="review-empty-state">No booking answers provided.</div>
        )}
      </Card.Body>
    </Card>
  );
};

export default BookingAnswersSummary;


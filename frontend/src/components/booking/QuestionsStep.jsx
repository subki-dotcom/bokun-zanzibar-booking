import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

const renderQuestionField = (question, value, onChange) => {
  const commonProps = {
    value: value || "",
    onChange: (event) => onChange(question.id, event.target.value)
  };

  switch (question.type) {
    case "textarea":
      return <Form.Control as="textarea" rows={3} {...commonProps} />;
    case "date":
      return <Form.Control type="date" {...commonProps} />;
    case "number":
      return <Form.Control type="number" {...commonProps} />;
    case "select":
      return (
        <Form.Select value={value || ""} onChange={(event) => onChange(question.id, event.target.value)}>
          <option value="">Choose an option</option>
          {(question.options || []).map((optionValue) => (
            <option key={optionValue} value={optionValue}>
              {optionValue}
            </option>
          ))}
        </Form.Select>
      );
    case "checkbox":
      return (
        <Form.Check
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(question.id, event.target.checked)}
          label={question.label}
        />
      );
    default:
      return <Form.Control type="text" {...commonProps} />;
  }
};

const QuestionsStep = ({ questions = [], answers = [], setAnswers, pax, priceCategoryParticipants = [], onBack, onNext }) => {
  const updateAnswer = (questionId, answer, scope = "booking", passengerIndex = null, label = "") => {
    setAnswers((prev) => {
      const copy = [...prev];
      const index = copy.findIndex(
        (item) =>
          item.questionId === questionId &&
          item.scope === scope &&
          (item.passengerIndex || null) === (passengerIndex || null)
      );

      const row = { questionId, label, scope, passengerIndex, answer };

      if (index === -1) {
        copy.push(row);
      } else {
        copy[index] = row;
      }

      return copy;
    });
  };

  const categoryPassengerTotal = (priceCategoryParticipants || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
  const totalPassengers =
    categoryPassengerTotal > 0
      ? categoryPassengerTotal
      : Number(pax.adults || 0) + Number(pax.children || 0);
  const bookingQuestions = questions.filter((question) => question.scope === "booking");
  const passengerQuestions = questions.filter((question) => question.scope === "passenger");

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Booking Questions</h4>

        <div className="d-grid gap-3">
          {bookingQuestions.map((question) => {
            const existing = answers.find(
              (answer) => answer.questionId === question.id && answer.scope === "booking"
            );

            return (
              <Form.Group key={question.id}>
                <Form.Label>
                  {question.label} {question.required ? "*" : ""}
                </Form.Label>
                {renderQuestionField(question, existing?.answer || "", (qid, value) =>
                  updateAnswer(qid, value, "booking", null, question.label)
                )}
              </Form.Group>
            );
          })}
        </div>

        {passengerQuestions.length ? <hr className="my-4" /> : null}

        {passengerQuestions.length
          ? Array.from({ length: totalPassengers }).map((_, passengerIndex) => (
              <div key={`p-${passengerIndex}`} className="mb-4">
                <h6 className="mb-2">Passenger {passengerIndex + 1}</h6>
                <div className="d-grid gap-3">
                  {passengerQuestions.map((question) => {
                    const existing = answers.find(
                      (answer) =>
                        answer.questionId === question.id &&
                        answer.scope === "passenger" &&
                        Number(answer.passengerIndex) === passengerIndex
                    );

                    return (
                      <Form.Group key={`${question.id}-${passengerIndex}`}>
                        <Form.Label>
                          {question.label} {question.required ? "*" : ""}
                        </Form.Label>
                        {renderQuestionField(question, existing?.answer || "", (qid, value) =>
                          updateAnswer(qid, value, "passenger", passengerIndex, question.label)
                        )}
                      </Form.Group>
                    );
                  })}
                </div>
              </div>
            ))
          : null}

        <div className="checkout-action-row mt-4">
          <Button variant="outline-secondary" onClick={onBack}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext}>
            Continue
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default QuestionsStep;

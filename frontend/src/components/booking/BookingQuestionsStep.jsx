import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import QuestionsStep from "./QuestionsStep";

const BookingQuestionsStep = ({
  questions = [],
  answers = [],
  setAnswers,
  pax,
  priceCategoryParticipants,
  onBack,
  onNext
}) => {
  if (!questions.length) {
    return (
      <Card className="surface-card smart-step-card">
        <Card.Body>
          <h4 className="mb-2">Booking questions</h4>
          <p className="text-muted mb-3">
            This product has no required booking questions for the selected setup.
          </p>
          <div className="d-flex justify-content-between">
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
  }

  return (
    <QuestionsStep
      questions={questions}
      answers={answers}
      setAnswers={setAnswers}
      pax={pax}
      priceCategoryParticipants={priceCategoryParticipants}
      onBack={onBack}
      onNext={onNext}
    />
  );
};

export default BookingQuestionsStep;


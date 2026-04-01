import Card from "react-bootstrap/Card";
import CustomerSummaryCard, { isCustomerSummaryValid } from "./CustomerSummaryCard";
import BookingAnswersSummary from "./BookingAnswersSummary";
import ExtrasSummaryCard from "./ExtrasSummaryCard";
import FinalPayableCard from "./FinalPayableCard";
import ConfirmActionRow from "./ConfirmActionRow";

const ReviewConfirmStep = ({ flowState = {}, submitting = false, onBack, onConfirm }) => {
  const customerValid = isCustomerSummaryValid(flowState.customer || {});
  const hasQuoteToken = Boolean(flowState?.quote?.quoteToken);
  const disableConfirm = !customerValid || !hasQuoteToken;
  const quoteCurrency = flowState?.quote?.pricing?.currency || "USD";

  return (
    <Card className="surface-card smart-step-card review-confirm-main-card">
      <Card.Body>
        <div className="review-confirm-header">
          <h4 className="mb-1">Review & Confirm</h4>
          <p className="mb-0">
            Review final customer and payment information before submission.
          </p>
        </div>

        <div className="review-confirm-stack mt-3">
          <CustomerSummaryCard customer={flowState.customer || {}} />
          <BookingAnswersSummary answers={flowState.answers || []} />
          <ExtrasSummaryCard extras={flowState.extras || []} currency={quoteCurrency} />
          <FinalPayableCard quote={flowState.quote || null} extras={flowState.extras || []} />
        </div>

        <div className="review-reassurance-note mt-3">
          Final booking will be confirmed in Bokun after successful Pesapal payment verification.
        </div>

        <ConfirmActionRow
          submitting={submitting}
          disableConfirm={disableConfirm}
          confirmLabel="Confirm & Pay"
          loadingLabel="Redirecting to Pesapal..."
          onBack={onBack}
          onConfirm={onConfirm}
        />
      </Card.Body>
    </Card>
  );
};

export default ReviewConfirmStep;

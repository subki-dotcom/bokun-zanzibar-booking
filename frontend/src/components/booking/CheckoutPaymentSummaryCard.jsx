import Card from "react-bootstrap/Card";
import { BsInfoCircle } from "react-icons/bs";
import { formatCurrency } from "../../utils/formatters";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const resolveCheckoutPricing = (flowState = {}) => {
  const pricing = flowState?.quote?.pricing || {};
  const currency = pricing.currency || "USD";
  const subtotal = toSafeNumber(pricing.baseAmount || pricing.grossAmount || pricing.finalPayable);
  const finalPayable = toSafeNumber(pricing.finalPayable || pricing.grossAmount || subtotal);
  const bookingFee = Math.max(0, finalPayable - subtotal);

  return {
    subtotal,
    bookingFee,
    finalPayable,
    currency
  };
};

const CheckoutPaymentSummaryCard = ({ flowState = {}, className = "" }) => {
  const { subtotal, bookingFee, finalPayable, currency } = resolveCheckoutPricing(flowState);

  return (
    <Card className={`surface-card smart-step-card checkout-payment-card ${className}`.trim()}>
      <Card.Body>
        <div className="review-confirm-header">
          <h4 className="mb-1">Payment Summary</h4>
        </div>

        <div className="checkout-payment-lines">
          <div>
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotal, currency)}</strong>
          </div>
          <div>
            <span>Booking Fee <BsInfoCircle /></span>
            <strong>{formatCurrency(bookingFee, currency)}</strong>
          </div>
          <div className="checkout-payment-total">
            <span>Total Payable</span>
            <strong>{formatCurrency(finalPayable, currency)}</strong>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CheckoutPaymentSummaryCard;

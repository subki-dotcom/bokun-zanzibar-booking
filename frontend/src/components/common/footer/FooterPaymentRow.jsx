import { usePaymentProviders } from "../../../context/PaymentProvidersContext";

const FooterPaymentRow = () => {
  const { availableProviders } = usePaymentProviders();
  if (!availableProviders.length) return null;

  return (
    <section className="premium-footer-payment-row">
      <div className="premium-footer-payment-title">Secure payment methods</div>
      <div className="premium-footer-payment-pills">
      {availableProviders.map((item) => (
        <span key={item.id} className="premium-footer-payment-pill">
          {item.title}
        </span>
      ))}
    </div>
  </section>
  );
};

export default FooterPaymentRow;

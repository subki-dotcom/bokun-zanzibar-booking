const payments = ["Visa", "Mastercard", "Pesapal", "Bank Transfer", "Cash"];

const FooterPaymentRow = () => (
  <section className="premium-footer-payment-row">
    <div className="premium-footer-payment-title">Accepted Payments</div>
    <div className="premium-footer-payment-pills">
      {payments.map((item) => (
        <span key={item} className="premium-footer-payment-pill">
          {item}
        </span>
      ))}
    </div>
  </section>
);

export default FooterPaymentRow;

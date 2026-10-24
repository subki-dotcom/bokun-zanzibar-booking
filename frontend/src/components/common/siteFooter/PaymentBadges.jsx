import { usePaymentProviders } from "../../../context/PaymentProvidersContext";

// What each payment provider lets a guest pay with.
const PROVIDER_METHODS = {
  pesapal: ["visa", "mastercard", "mpesa", "pesapal"],
  dpo: ["visa", "mastercard"],
  paypal: ["paypal"]
};

const BADGES = [
  { id: "visa", label: "VISA" },
  { id: "mastercard", label: "Mastercard" },
  { id: "mpesa", label: "M-Pesa" },
  { id: "paypal", label: "PayPal" },
  { id: "pesapal", label: "Pesapal" }
];

// White badges for the payment methods that are switched on right now.
const PaymentBadges = () => {
  const { availableProviders } = usePaymentProviders();
  const methods = new Set(availableProviders.flatMap((provider) => PROVIDER_METHODS[provider.id] || []));
  const badges = BADGES.filter((badge) => methods.has(badge.id));
  if (!badges.length) return null;

  return (
    <ul className="sf-pay" aria-label="Payment methods">
      {badges.map((badge) => (
        <li key={badge.id} className="sf-pay-badge">
          {badge.label}
        </li>
      ))}
    </ul>
  );
};

export default PaymentBadges;

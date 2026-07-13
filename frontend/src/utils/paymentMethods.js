export const PAYMENT_METHODS = [
  {
    id: "pesapal",
    title: "Pesapal",
    subtitle: "Cards, mobile money, and local checkout options.",
    logo: "/assets/payment-logos/pesapal.svg",
    badge: "Recommended",
    enabled: true
  },
  {
    id: "dpo",
    title: "DPO",
    subtitle: "Secure card checkout for Visa and Mastercard.",
    logo: "/assets/payment-logos/dpo.svg",
    badge: "Cards",
    enabled: true
  },
  {
    id: "paypal",
    title: "PayPal",
    subtitle: "Pay with your PayPal account or supported cards.",
    logo: "/assets/payment-logos/paypal.svg",
    badge: "PayPal",
    enabled: true
  }
];

export const getPaymentMethod = (methodId = "pesapal") =>
  PAYMENT_METHODS.find((method) => method.id === methodId) || PAYMENT_METHODS[0];

export const getPaymentMethodLabel = (methodId = "pesapal") => getPaymentMethod(methodId).title;

export const isPaymentMethodEnabled = (methodId = "pesapal") => Boolean(getPaymentMethod(methodId).enabled);

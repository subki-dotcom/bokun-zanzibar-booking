export const BOOKING_ACCOUNTING_VIEW_CONFIG = {
  dashboard: {
    title: "Booking Accounting Dashboard",
    eyebrow: "Booking Accounting",
    subtitle: "Invoices, payments, refunds, booking-linked expenses, profitability and reconciliation evidence."
  },
  invoices: {
    title: "Invoices",
    eyebrow: "Booking Accounting",
    subtitle: "Invoice payment state, paid amount, refunds, net paid amount and balance due."
  },
  refunds: {
    title: "Refunds",
    eyebrow: "Booking Accounting",
    subtitle: "Refund request state, confirmed refunded amount, provider evidence and completion timestamps."
  },
  expenses: {
    title: "Booking Expenses",
    eyebrow: "Booking Accounting",
    subtitle: "Business expense records that are linked to bookings or booking accounting source modules."
  },
  "cost-templates": {
    title: "Product Cost Templates",
    eyebrow: "Booking Accounting",
    subtitle: "Controlled cost categories and supported cost basis rules for booking cost setup."
  },
  profitability: {
    title: "Booking Profitability",
    eyebrow: "Booking Accounting",
    subtitle: "Revenue, refunds, provider fees, direct costs, gross profit and margin by booking."
  },
  reconciliation: {
    title: "Reconciliation",
    eyebrow: "Booking Accounting",
    subtitle: "Booking, invoice, payment, refund and booking-expense consistency checks."
  }
};

export const bookingAccountingModeFromPath = (pathname = "") => {
  const tail = String(pathname || "").split("/").filter(Boolean).pop();
  return BOOKING_ACCOUNTING_VIEW_CONFIG[tail] ? tail : "dashboard";
};

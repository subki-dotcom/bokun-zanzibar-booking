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
  "cost-template-new": {
    title: "Create Cost Template",
    eyebrow: "Booking Accounting / Cost Templates",
    subtitle: "Select a Bókun product option and define estimated internal cost rules."
  },
  "cost-template-edit": {
    title: "Edit Cost Template",
    eyebrow: "Booking Accounting / Cost Templates",
    subtitle: "Update internal cost rules without changing Bókun product identity."
  },
  "cost-template-view": {
    title: "Cost Template",
    eyebrow: "Booking Accounting / Cost Templates",
    subtitle: "Review the current cost rules and estimated booking cost."
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
  const parts = String(pathname || "").split("/").filter(Boolean);
  const tail = parts[parts.length - 1];
  if (parts.includes("cost-templates") && tail === "new") return "cost-template-new";
  if (parts.includes("cost-templates") && tail === "edit") return "cost-template-edit";
  if (parts.includes("cost-templates") && tail !== "cost-templates") return "cost-template-view";
  return BOOKING_ACCOUNTING_VIEW_CONFIG[tail] ? tail : "dashboard";
};

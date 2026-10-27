// Invoices and credit notes as customer documents. Pure: no database or network.
// buildInvoiceDocument freezes what an issued invoice says (number, date, parties, lines, totals); documentView
// adds the payment state (paid, refunded, balance) the page and the PDF show next to it.

const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;
const PROVIDERS = { pesapal: "Pesapal", dpo: "DPO", paypal: "PayPal", manual_bank: "Bank transfer", manual_bank_transfer: "Bank transfer", cash: "Cash", cash_on_arrival: "Cash" };

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const cents = (value) => Math.round(Number(value || 0) * 100) / 100;

// "Free cancellation until 29 Nov 2026, 09:00 (Zanzibar time). No refund after that or for no-shows."
const cancellationText = (policy = {}) => {
  const ms = Date.parse(policy?.deadline || "");
  if (Number.isFinite(ms) && policy?.refundable !== false) {
    const local = new Date(ms + ZANZIBAR_OFFSET_MS);
    const day = local.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return `Free cancellation until ${day}, ${local.toISOString().slice(11, 16)} (Zanzibar time). No refund after that or for no-shows.`;
  }
  if (policy?.refundable === false) return "This booking is non-refundable.";
  return text(policy?.policySummary || policy?.policyDescription) || "Cancellation terms follow the tour's cancellation policy.";
};

const lineItemsFor = ({ invoice = {}, booking = {}, tour = "", option = "" }) => {
  const date = text(invoice.tourDate || booking.travelDate).slice(0, 10);
  const rows = (invoice.items || [])
    .filter((item) => Number(item.quantity || 0) > 0 || Number(item.total || 0) !== 0)
    .map((item) => {
      const qty = Number(item.quantity || 1);
      const amount = cents(item.total ?? Number(item.unitPrice || 0) * qty);
      return {
        description: tour,
        subDescription: [option, text(item.label)].filter(Boolean).join(" · "),
        date,
        qty,
        unitPrice: cents(item.unitPrice ?? amount / qty),
        amount
      };
    });
  if (!rows.length) {
    const amount = cents(invoice.subtotal ?? invoice.total);
    const pax = Number(invoice.totalPax || Number(invoice.adults || 0) + Number(invoice.children || 0)) || 1;
    rows.push({ description: tour, subDescription: option, date, qty: pax, unitPrice: cents(amount / pax), amount });
  }
  if (text(invoice.hotelName || booking.customer?.hotelName)) {
    rows.push({ description: "Hotel pickup", subDescription: "", date: "", qty: 1, unitPrice: null, amount: 0, included: true });
  }
  return rows;
};

// The frozen customer copy of an invoice, made once when it is issued.
const buildInvoiceDocument = ({ invoice = {}, booking = {}, policy = null, company = {}, number = "", issuedAt = new Date() }) => {
  const tour = text(invoice.tourName || booking.productTitle);
  const option = text(invoice.bookedOption || booking.optionTitle).replace(/^\s*w\/\s*/i, "");
  const subtotal = cents(invoice.subtotal ?? invoice.total);
  const discount = cents(invoice.discount);
  const taxAmount = cents(invoice.tax);
  return {
    kind: "invoice",
    number: number || text(invoice.invoiceNumber),
    issueDate: new Date(invoice.issueDate || issuedAt).toISOString(),
    bookingReference: text(invoice.bookingReference || booking.bookingReference),
    currency: text(invoice.transactionCurrency || booking.currency || "USD").toUpperCase(),
    company: { ...company },
    billedTo: {
      name: text(invoice.clientName) || `${text(booking.customer?.firstName)} ${text(booking.customer?.lastName)}`.trim(),
      email: text(invoice.clientEmail || booking.customer?.email),
      phone: text(invoice.clientPhone || booking.customer?.phone),
      country: text(invoice.clientCountry || booking.customer?.country),
      company: text(booking.customer?.company),
      taxId: text(booking.customer?.taxId || booking.customer?.vatNumber)
    },
    trip: {
      tour,
      option,
      date: text(invoice.tourDate || booking.travelDate).slice(0, 10),
      startTime: text(invoice.pickupTime || booking.startTime),
      pickup: text(invoice.pickupLocation || invoice.hotelName || booking.customer?.hotelName)
    },
    lineItems: lineItemsFor({ invoice, booking, tour, option }),
    subtotal,
    discount,
    // Only when the company is VAT registered.
    tax: company.vatRegistered ? { label: company.taxLabel || "VAT", rate: Number(company.taxRate || 0), amount: taxAmount } : null,
    total: cents(invoice.total),
    cancellationPolicyText: cancellationText(policy || booking.cancellationPolicySnapshot || {})
  };
};

// A credit note for a refund, in the same template.
const buildCreditNoteDocument = ({ invoiceDocument, number, amount, reason = "", issuedAt = new Date() }) => ({
  ...invoiceDocument,
  kind: "credit_note",
  number,
  issueDate: new Date(issuedAt).toISOString(),
  creditFor: invoiceDocument.number,
  lineItems: [
    {
      description: "Refund",
      subDescription: [`Invoice ${invoiceDocument.number}`, reason].filter(Boolean).join(" · "),
      date: new Date(issuedAt).toISOString().slice(0, 10),
      qty: 1,
      unitPrice: cents(amount),
      amount: cents(amount)
    }
  ],
  subtotal: cents(amount),
  discount: 0,
  tax: null,
  total: cents(amount)
});

// "Card via Pesapal", "Visa", "1234" from the provider's answer (never the full card number).
const paymentLine = (payment = {}) => {
  const raw = payment.providerResponse || {};
  const brand = text(raw.payment_method || raw.paymentMethod || raw.card_brand);
  const last4 = (text(raw.payment_account || raw.card_last4 || raw.cardNumber).match(/(\d{4})\D*$/) || [])[1] || "";
  const provider = PROVIDERS[lower(payment.provider)] || text(payment.provider);
  const card = /visa|master|amex|american|card|discover|union/i.test(brand) || Boolean(last4);
  return {
    method: card ? `Card via ${provider}` : brand ? `${brand} via ${provider}` : provider,
    brand: card ? brand : "",
    last4,
    transactionId: text(raw.confirmation_code || payment.providerTransactionId || payment.orderTrackingId || payment.merchantReference),
    paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : "",
    amount: cents(payment.amountPaid ?? payment.amount)
  };
};

// PAID / PARTIALLY PAID / UNPAID / REFUNDED / CANCELLED (stamp colour by tone).
const invoiceStatus = ({ invoice = {}, bookingStatus = "" }) => {
  const paid = cents(invoice.amountPaid);
  const refunded = cents(invoice.amountRefunded);
  const total = cents(invoice.total);
  if (paid > 0 && refunded + 0.009 >= paid) return { key: "refunded", label: "REFUNDED", tone: "danger" };
  if (lower(bookingStatus || invoice.bookingStatus) === "cancelled" && paid <= 0) return { key: "cancelled", label: "CANCELLED", tone: "danger" };
  if (paid > 0 && paid + 0.009 >= total) return { key: "paid", label: "PAID", tone: "brand" };
  if (paid > 0) return { key: "partially_paid", label: "PARTIALLY PAID", tone: "warning" };
  return { key: "unpaid", label: "UNPAID", tone: "warning" };
};

// What the page and the PDF show: the frozen document plus the payment state and links.
const documentView = ({ document, invoice = {}, payments = [], creditNotes = [], bookingStatus = "", verificationUrl = "" }) => {
  if (document.kind === "credit_note") {
    return {
      ...document,
      status: { key: "credit_note", label: "CREDIT NOTE", tone: "danger" },
      amountPaid: document.total,
      amountRefunded: 0,
      balanceDue: 0,
      payments: [],
      paymentDate: "",
      creditNotes: [],
      verificationUrl
    };
  }
  const status = invoiceStatus({ invoice, bookingStatus });
  const amountPaid = cents(invoice.amountPaid);
  const amountRefunded = cents(invoice.amountRefunded);
  const cancelled = lower(bookingStatus || invoice.bookingStatus) === "cancelled";
  const balanceDue = cancelled ? 0 : Math.max(0, cents(document.total - (amountPaid - amountRefunded)));
  const lines = payments.filter((payment) => payment.paidAt || lower(payment.status) === "paid").map(paymentLine);
  return {
    ...document,
    status,
    amountPaid,
    amountRefunded,
    balanceDue,
    payments: lines,
    paymentDate: lines.map((line) => line.paidAt).filter(Boolean).sort().at(-1) || "",
    creditNotes: creditNotes.map((note) => ({ number: note.creditNoteNumber, issueDate: new Date(note.issueDate).toISOString(), total: cents(note.document?.total) })),
    verificationUrl
  };
};

module.exports = { buildInvoiceDocument, buildCreditNoteDocument, documentView, invoiceStatus, paymentLine, cancellationText };

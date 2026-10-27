// Customer invoices and credit notes: issued once (frozen copy), numbered INV-/CN-{YYYY}-{00001}, shown on the
// web page and as a PDF from the same data, verifiable by a public token, downloadable by a short-lived signed
// link. The accounting invoice record is not changed except for the frozen copy and the verification token.
const crypto = require("crypto");
const Invoice = require("../../models/Invoice");
const CreditNote = require("../../models/CreditNote");
const Booking = require("../../models/Booking");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const ProductSnapshot = require("../../models/ProductSnapshot");
const logger = require("../../config/logger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { calculateCancellationPolicy } = require("../cancellations/policy");
const { companyDetails } = require("./company");
const { nextDocumentNumber } = require("./numbering");
const { buildInvoiceDocument, buildCreditNoteDocument, documentView } = require("./view");
const { renderDocumentPdf, pdfFileName } = require("./pdf");
const QRCode = require("qrcode");

// The same QR as in the PDF, as an SVG data URL for the web page.
const withQr = async (view) => ({
  ...view,
  verificationQr: view.verificationUrl
    ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(view.verificationUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#14211F", light: "#FFFFFF" } })).toString("base64")}`
    : ""
});

const LINK_TTL_MS = 10 * 60 * 1000;
const notFound = () => new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
const cents = (value) => Math.round(Number(value || 0) * 100) / 100;
const randomToken = () => crypto.randomBytes(16).toString("base64url");

const siteUrl = () =>
  String(env.PUBLIC_SITE_URL || String(env.FRONTEND_URL || "").split(",")[0] || "").trim().replace(/\/+$/, "");
const verificationUrl = (token) => (token ? `${siteUrl()}/verify/${token}` : "");

// Freezes the customer copy the first time an invoice is shown, sent or downloaded. If the booking total later
// changes (an approved traveler change), the old copy is cancelled by a credit note and a new invoice is issued.
const ensureIssued = async (invoice) => {
  const booking = await Booking.findOne({ bookingReference: invoice.bookingReference }).lean();
  if (!booking) throw notFound();
  if (invoice.document && cents(invoice.document.total) === cents(invoice.total)) return { invoice, booking };

  const product = await ProductSnapshot.findOne({ bokunProductId: String(booking.bokunProductId || "") }, { cancellationPolicy: 1 }).lean();
  const policy = calculateCancellationPolicy({ booking, productSnapshot: product });
  const company = companyDetails();

  if (!invoice.document) {
    const document = buildInvoiceDocument({ invoice, booking, policy, company, number: invoice.invoiceNumber, issuedAt: invoice.issueDate || new Date() });
    const issued = await Invoice.findOneAndUpdate(
      { _id: invoice._id, document: null },
      { $set: { document, documentIssuedAt: new Date(), verificationToken: invoice.verificationToken || randomToken() } },
      { new: true }
    ).lean();
    return { invoice: issued || (await Invoice.findById(invoice._id).lean()), booking };
  }

  // The total changed after issue: credit the old copy in full, then issue a new number.
  const previous = invoice.document;
  const number = await nextDocumentNumber("INV");
  const document = buildInvoiceDocument({ invoice, booking, policy, company, number, issuedAt: new Date() });
  // Only the request that replaces the copy writes the credit note.
  const reissued = await Invoice.findOneAndUpdate(
    { _id: invoice._id, "document.number": previous.number },
    { $set: { document, documentIssuedAt: new Date(), verificationToken: randomToken() } },
    { new: true }
  ).lean();
  if (!reissued) return { invoice: await Invoice.findById(invoice._id).lean(), booking };
  const creditNumber = await nextDocumentNumber("CN");
  await CreditNote.create({
    creditNoteNumber: creditNumber,
    invoiceNumber: previous.number,
    bookingReference: invoice.bookingReference,
    issueDate: new Date(),
    reason: `Booking changed – replaced by invoice ${number}`,
    document: buildCreditNoteDocument({ invoiceDocument: previous, number: creditNumber, amount: previous.total, reason: `Replaced by ${number}` }),
    verificationToken: randomToken()
  });
  logger.info("Invoice reissued after a booking change", { bookingReference: invoice.bookingReference, previous: previous.number, number, creditNote: creditNumber });
  return { invoice: reissued, booking };
};

// One credit note per confirmed refund.
const ensureRefundCreditNotes = async (invoice, booking) => {
  const refunds = await Refund.find({ bookingId: booking._id, status: { $in: ["refunded", "partially_refunded"] } }).lean();
  for (const refund of refunds) {
    if (await CreditNote.exists({ refund: refund._id })) continue;
    const amount = cents(refund.confirmedRefundedAmount || refund.amount);
    if (amount <= 0) continue;
    const number = await nextDocumentNumber("CN");
    try {
      await CreditNote.create({
        creditNoteNumber: number,
        invoiceNumber: invoice.document.number,
        bookingReference: invoice.bookingReference,
        refund: refund._id,
        issueDate: refund.completedAt || new Date(),
        reason: "Refund",
        document: buildCreditNoteDocument({ invoiceDocument: invoice.document, number, amount, reason: "Refund", issuedAt: refund.completedAt || new Date() }),
        verificationToken: randomToken()
      });
    } catch (error) {
      // Made at the same moment by another request: that one stands (this number stays unused).
      if (error?.code !== 11000) throw error;
    }
  }
  return CreditNote.find({ bookingReference: invoice.bookingReference }).sort({ issueDate: 1 }).lean();
};

const invoiceViewFor = async (invoiceRecord) => {
  const { invoice, booking } = await ensureIssued(invoiceRecord);
  const [payments, creditNotes] = await Promise.all([
    Payment.find({ bookingReference: invoice.bookingReference, status: { $in: ["paid", "partially_refunded", "refunded"] } }).sort({ paidAt: 1 }).lean(),
    ensureRefundCreditNotes(invoice, booking)
  ]);
  return {
    invoice: documentView({ document: invoice.document, invoice, payments, creditNotes, bookingStatus: booking.bookingStatus, verificationUrl: verificationUrl(invoice.verificationToken) }),
    creditNotes: creditNotes.map((note) => documentView({ document: note.document, verificationUrl: verificationUrl(note.verificationToken) }))
  };
};

// For the web page: the views plus their QR images.
const withQrCodes = async (views) => ({
  invoice: await withQr(views.invoice),
  creditNotes: await Promise.all(views.creditNotes.map(withQr))
});

const getByBookingReference = async (bookingReference) => {
  const invoice = await Invoice.findOne({ bookingReference }).lean();
  if (!invoice) throw notFound();
  return invoiceViewFor(invoice);
};

const getByNumber = async (number) => {
  const value = String(number || "").trim();
  if (/^CN-/i.test(value)) {
    const note = await CreditNote.findOne({ creditNoteNumber: value.toUpperCase() }).lean();
    if (!note) throw notFound();
    return getByBookingReference(note.bookingReference);
  }
  const invoice = await Invoice.findOne({ $or: [{ invoiceNumber: value }, { "document.number": value }] }).lean();
  if (!invoice) throw notFound();
  return invoiceViewFor(invoice);
};

// The invoice or one of its credit notes, from a booking's documents.
const pickDocument = (views, number = "") => {
  if (!number || number === views.invoice.number) return views.invoice;
  const note = views.creditNotes.find((item) => item.number === number);
  if (!note) throw notFound();
  return note;
};

// Generated PDFs, per document and state (a payment or refund changes the key, so it is drawn again).
const pdfCache = new Map();
const PDF_CACHE_SIZE = 40;
const pdfFor = async (view) => {
  const key = crypto.createHash("sha256").update(JSON.stringify(view)).digest("hex");
  if (pdfCache.has(key)) return { buffer: pdfCache.get(key), filename: pdfFileName(view) };
  const buffer = await renderDocumentPdf(view);
  pdfCache.set(key, buffer);
  if (pdfCache.size > PDF_CACHE_SIZE) pdfCache.delete(pdfCache.keys().next().value);
  return { buffer, filename: pdfFileName(view) };
};

// Download links that work for 10 minutes: "<payload>.<signature>".
const sign = (payload) => crypto.createHmac("sha256", String(env.JWT_SECRET)).update(`riser-document-link:${payload}`).digest("base64url");
const signDownloadLink = ({ bookingReference, number, now = Date.now() }) => {
  const expiresAt = now + LINK_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ r: bookingReference, n: number, e: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(expiresAt).toISOString() };
};
const readDownloadLink = (token = "", now = Date.now()) => {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.e) > now ? { bookingReference: data.r, number: data.n } : null;
  } catch {
    return null;
  }
};

const pdfFromLink = async (token) => {
  const link = readDownloadLink(token);
  if (!link) throw new AppError("This download link has expired. Please download the invoice again.", 410, "INVOICE_LINK_EXPIRED");
  return pdfFor(pickDocument(await getByBookingReference(link.bookingReference), link.number));
};

// The public "Scan to verify" answer: no personal data.
const verify = async (token = "") => {
  const value = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(value)) throw notFound();
  const note = await CreditNote.findOne({ verificationToken: value }).lean();
  if (note) {
    return { valid: true, kind: "credit_note", company: note.document.company?.name || "", number: note.creditNoteNumber, issueDate: note.document.issueDate, total: note.document.total, currency: note.document.currency, status: "CREDIT NOTE" };
  }
  const invoice = await Invoice.findOne({ verificationToken: value }).lean();
  if (!invoice?.document) throw notFound();
  const views = await invoiceViewFor(invoice);
  return {
    valid: true,
    kind: "invoice",
    company: views.invoice.company?.name || "",
    number: views.invoice.number,
    issueDate: views.invoice.issueDate,
    total: views.invoice.total,
    currency: views.invoice.currency,
    status: views.invoice.status.label
  };
};

module.exports = {
  getByBookingReference,
  getByNumber,
  pickDocument,
  withQrCodes,
  pdfFor,
  signDownloadLink,
  readDownloadLink,
  pdfFromLink,
  verify,
  LINK_TTL_MS
};

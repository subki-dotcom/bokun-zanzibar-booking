const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const AppError = require("../utils/AppError");
const invoicesService = require("../services/invoices");

const getByBookingReference = asyncHandler(async (req, res) => {
  const invoice = await invoicesService.getInvoiceByBookingReference(req.params.bookingReference);

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return successResponse(res, {
    message: "Invoice fetched",
    data: invoice
  });
});

const getByInvoiceNumber = asyncHandler(async (req, res) => {
  const invoice = await invoicesService.getInvoiceByNumber(req.params.invoiceNumber);

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return successResponse(res, {
    message: "Invoice fetched",
    data: (await require('../services/bookingPayment/view').enrichPaymentViews([invoice]))[0]
  });
});

const invoiceDocuments = () => require("../services/invoiceDocuments");

const verify = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Invoice verified", data: await invoiceDocuments().verify(req.params.token) })
);

const documentByNumber = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Invoice document", data: await invoiceDocuments().withQrCodes(await invoiceDocuments().getByNumber(req.params.invoiceNumber)) })
);

// ?document=CN-2026-00001 for one of the invoice's credit notes.
const pdfByNumber = asyncHandler(async (req, res) => {
  const views = await invoiceDocuments().getByNumber(req.params.invoiceNumber);
  const { buffer, filename } = await invoiceDocuments().pdfFor(invoiceDocuments().pickDocument(views, /^CN-/i.test(req.params.invoiceNumber) ? req.params.invoiceNumber.toUpperCase() : String(req.query.document || "")));
  res.type("application/pdf");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
});

module.exports = {
  verify,
  documentByNumber,
  pdfByNumber,
  getByBookingReference,
  getByInvoiceNumber
};

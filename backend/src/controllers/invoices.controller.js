const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const AppError = require("../utils/AppError");
const invoicesService = require("../services/invoices");
const { ACCESS_TOKEN_HEADER } = require("../security/bookingAccess");

// Same answer for a missing invoice and one the caller may not see.
const invoiceNotFound = () => new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");

const getByBookingReference = asyncHandler(async (req, res) => {
  const result = await invoicesService.getAuthorizedInvoiceByBookingReference({
    bookingReference: req.params.bookingReference,
    auth: req.auth || null,
    accessToken: req.get(ACCESS_TOKEN_HEADER) || ""
  });

  if (!result) {
    throw invoiceNotFound();
  }

  return successResponse(res, {
    message: "Invoice fetched",
    data: result.invoice
  });
});

const getByInvoiceNumber = asyncHandler(async (req, res) => {
  const result = await invoicesService.getAuthorizedInvoiceByNumber({
    invoiceNumber: req.params.invoiceNumber,
    auth: req.auth || null
  });

  if (!result) {
    throw invoiceNotFound();
  }

  return successResponse(res, {
    message: "Invoice fetched",
    data: result.access === "back_office"
      ? (await require('../services/bookingPayment/view').enrichPaymentViews([result.invoice]))[0]
      : result.invoice
  });
});

module.exports = {
  getByBookingReference,
  getByInvoiceNumber
};

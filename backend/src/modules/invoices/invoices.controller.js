const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const AppError = require("../../utils/AppError");
const invoicesService = require("./invoices.service");

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
    data: invoice
  });
});

module.exports = {
  getByBookingReference,
  getByInvoiceNumber
};
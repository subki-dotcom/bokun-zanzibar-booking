const businessAccountingService = require("../services/businessAccounting");
const BusinessExpense = require("../models/BusinessExpense");
const expenseAccountingService = require("../services/expenseAccounting");
const supplierPaymentsService = require("../services/supplierPayments");
const ledger = require("../services/generalLedger/ledger");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const list = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.listBusinessExpenses(req.validated?.query || {});
  return successResponse(res, {
    message: "Business expenses fetched",
    data
  });
});

const create = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.createBusinessExpense({
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business expense created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const update = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.updateBusinessExpense({
    expenseId: req.validated.params.id,
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business expense updated",
    data
  });
});

const previewPosting = asyncHandler(async (req, res) => {
  const expense = await BusinessExpense.findById(req.params.id).lean();
  if (!expense) return res.status(404).json({ success: false, message: "Business expense not found" });
  const data = await expenseAccountingService.previewExpensePosting({ expense });
  return successResponse(res, { message: "Expense posting preview generated", data });
});

const post = asyncHandler(async (req, res) => {
  const expense = await BusinessExpense.findById(req.params.id).lean();
  if (!expense) return res.status(404).json({ success: false, message: "Business expense not found" });
  const data = await expenseAccountingService.postExpense({
    expense,
    auth: req.auth,
    requestId: req.requestId,
    mode: process.env.EXPENSE_POSTING_MODE || "PREVIEW_ONLY"
  });
  return successResponse(res, { message: "Expense posting processed", data });
});

const createSupplierPayment = asyncHandler(async (req, res) => {
  const data = await supplierPaymentsService.createSupplierPayment({
    input: req.validated?.body || req.body || {},
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, { message: "Supplier payment processed", data, statusCode: data.action === "created" ? 201 : 200 });
});

const approve = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.updateBusinessExpense({
    expenseId: req.validated.params.id,
    input: { status: "APPROVED" },
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, { message: "Business expense approved", data });
});

const reverse = asyncHandler(async (req, res) => {
  const expense = await BusinessExpense.findById(req.validated.params.id).lean();
  if (!expense) return res.status(404).json({ success: false, message: "Business expense not found" });
  if (!expense.journalEntryId) return res.status(409).json({ success: false, message: "Expense has no posted journal to reverse" });
  const data = await ledger.reverseJournal({
    journalId: expense.journalEntryId,
    reason: req.body?.reason || "Expense reversal",
    auth: req.auth,
    requestId: req.requestId
  });
  await BusinessExpense.updateOne({ _id: expense._id }, { $set: { accountingStatus: "REVERSED" } });
  return successResponse(res, { message: "Business expense reversed", data });
});

module.exports = {
  create,
  list,
  update,
  previewPosting,
  post,
  createSupplierPayment,
  approve,
  reverse
};

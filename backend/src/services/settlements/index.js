const crypto = require("crypto");
const Settlement = require("../../models/Settlement");
const SettlementAllocation = require("../../models/SettlementAllocation");
const Booking = require("../../models/Booking");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const { toDecimal, normalizeCurrency } = require("../../utils/money");

const PROVIDERS = new Set(["GETYOURGUIDE", "VIATOR", "PESAPAL", "DPO", "PAYPAL", "BANK", "MANUAL", "OTHER"]);
const EVIDENCE = new Set(["PROVIDER_API", "PROVIDER_STATEMENT", "CSV_IMPORT", "BANK_MATCH", "MANUAL_VERIFIED", "OTHER"]);
const previewStore = new Map();
const money = (amount, currency) => amount === null || amount === undefined || amount === "" || !currency ? null : { amount: toDecimal(amount, { allowNegative: false }).toFixed(), currency: normalizeCurrency(currency) };
const idempotency = ({ provider, providerSettlementReference, evidenceReference }) => crypto.createHash("sha256").update([provider, providerSettlementReference, evidenceReference].map(String).join("|")).digest("hex");

const calculateExpectedSettlement = ({ gross, commission = null, fees = null, refunds = null, adjustments = [], currency }) => {
  const code = normalizeCurrency(currency || gross?.currency || commission?.currency || fees?.currency || "");
  if (!code || !gross?.amount || !commission?.amount) return { expectedNet: null, reason: "EXPECTATION_UNAVAILABLE" };
  const values = [commission, fees, refunds, ...adjustments].filter(Boolean);
  if (values.some((value) => normalizeCurrency(value.currency) !== code)) return { expectedNet: null, reason: "CURRENCY_MISMATCH" };
  const expected = toDecimal(gross.amount, { allowNegative: false })
    .minus(toDecimal(commission.amount, { allowNegative: false }))
    .minus(toDecimal(fees?.amount || 0, { allowNegative: false }))
    .minus(toDecimal(refunds?.amount || 0, { allowNegative: false }))
    .plus(adjustments.filter((adjustment) => adjustment.type === "MANUAL_ADJUSTMENT").reduce((sum, adjustment) => sum.plus(toDecimal(adjustment.amount, { allowNegative: false })), toDecimal(0)));
  return { expectedNet: { amount: expected.toFixed(), currency: code }, reason: "CALCULATED_FROM_EXPLICIT_EVIDENCE" };
};

const summarizeSettlement = ({ expectedNet, received, allocated }) => {
  if (!received) return { status: expectedNet ? "PENDING" : "NEEDS_REVIEW", outstanding: expectedNet, reason: expectedNet ? "SETTLEMENT_PENDING" : "EXPECTATION_UNAVAILABLE" };
  if (expectedNet && expectedNet.currency !== received.currency) return { status: "MISMATCH", outstanding: null, reason: "CURRENCY_MISMATCH" };
  const allocatedAmount = allocated?.amount || "0";
  const receivedAmount = toDecimal(received.amount, { allowNegative: false });
  const allocatedDecimal = toDecimal(allocatedAmount, { allowNegative: false });
  const outstanding = expectedNet ? toDecimal(expectedNet.amount, { allowNegative: false }).minus(allocatedDecimal) : null;
  const allocationDifference = receivedAmount.minus(allocatedDecimal);
  if (allocationDifference.isNegative()) return { status: "NEEDS_REVIEW", outstanding: null, reason: "OVER_ALLOCATED" };
  if (!expectedNet) return { status: allocationDifference.isZero() ? "RECEIVED" : "NEEDS_REVIEW", outstanding: null, reason: "EXPECTATION_UNAVAILABLE" };
  if (outstanding.isZero() && allocationDifference.isZero()) return { status: "RECONCILED", outstanding: { amount: "0", currency: expectedNet.currency }, reason: "SETTLEMENT_MATCHED" };
  if (allocatedDecimal.isZero()) return { status: "RECEIVED", outstanding: { amount: toDecimal(expectedNet.amount, { allowNegative: false }).toFixed(), currency: expectedNet.currency }, reason: "UNALLOCATED" };
  return { status: "PARTIALLY_RECEIVED", outstanding: { amount: outstanding.toFixed(), currency: expectedNet.currency }, reason: "SETTLEMENT_PARTIAL" };
};

const parseCsv = (text = "") => {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < String(text).length; index += 1) {
    const char = String(text)[index];
    if (char === '"' && quoted && String(text)[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell.trim()); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) { if (char === "\r" && String(text)[index + 1] === "\n") index += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; continue; }
    cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((values, rowIndex) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]).concat([["rowNumber", rowIndex + 2]])));
};

const normalizeImportProvider = (value) => {
  const provider = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return provider === "GYG" ? "GETYOURGUIDE" : provider === "VIATOR" ? "VIATOR" : provider;
};

const previewImport = async ({ csv, SettlementModel = Settlement, BookingModel = Booking } = {}) => {
  const rows = parseCsv(csv);
  const required = ["settlement_reference", "provider", "amount", "currency", "evidence_reference"];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missingColumns = required.filter((column) => !headers.includes(column));
  if (!rows.length || missingColumns.length) return { token: null, status: "INVALID", missingColumns, rows: [] };
  const references = [...new Set(rows.map((row) => row.booking_reference).filter(Boolean))];
  const bookings = references.length ? await BookingModel.find({ bookingReference: { $in: references } }).select("_id bookingReference transactionCurrency currency pricingSnapshot").lean() : [];
  const bookingMap = new Map(bookings.map((booking) => [booking.bookingReference, booking]));
  const existingRefs = new Set((await SettlementModel.find({ settlementReference: { $in: [...new Set(rows.map((row) => row.settlement_reference).filter(Boolean))] } }).select("settlementReference").lean()).map((row) => row.settlementReference));
  const seen = new Set();
  const previewRows = rows.map((row) => {
    const provider = normalizeImportProvider(row.provider); const amount = Number(row.amount); const currency = String(row.currency || "").trim().toUpperCase(); const identity = `${provider}:${row.settlement_reference}`; const reasons = [];
    if (!row.settlement_reference) reasons.push("MISSING_REFERENCE");
    if (!PROVIDERS.has(provider)) reasons.push("UNSUPPORTED_PROVIDER");
    if (!Number.isFinite(amount) || amount <= 0) reasons.push("INVALID_AMOUNT");
    if (!/^[A-Z]{3}$/.test(currency)) reasons.push("INVALID_CURRENCY");
    if (seen.has(identity) || existingRefs.has(row.settlement_reference)) reasons.push("DUPLICATE");
    seen.add(identity);
    let booking = null;
    if (row.booking_reference) booking = bookingMap.get(row.booking_reference) || null;
    if (row.booking_reference && !booking) reasons.push("UNKNOWN_BOOKING");
    const bookingCurrency = booking && String(booking.transactionCurrency || booking.currency || booking.pricingSnapshot?.currency || "").toUpperCase();
    if (bookingCurrency && currency && bookingCurrency !== currency) reasons.push("CURRENCY_MISMATCH");
    return { rowNumber: row.rowNumber, settlementReference: row.settlement_reference, provider, providerSettlementReference: row.provider_settlement_reference || "", amount, currency, evidenceReference: row.evidence_reference, bookingReference: row.booking_reference || "", bookingId: booking?._id || null, classification: reasons.length ? (reasons.includes("DUPLICATE") ? "DUPLICATE" : reasons.includes("UNKNOWN_BOOKING") ? "UNKNOWN_BOOKING" : reasons.includes("CURRENCY_MISMATCH") ? "CURRENCY_MISMATCH" : reasons.includes("INVALID_AMOUNT") ? "INVALID_AMOUNT" : reasons.includes("MISSING_REFERENCE") ? "MISSING_REFERENCE" : "NEEDS_REVIEW") : "READY", reasons };
  });
  const token = crypto.createHash("sha256").update(JSON.stringify(previewRows)).digest("hex");
  previewStore.set(token, { rows: previewRows, createdAt: Date.now() });
  return { token, status: previewRows.every((row) => row.classification === "READY") ? "READY" : "NEEDS_REVIEW", rows: previewRows, summary: previewRows.reduce((out, row) => { out[row.classification] = (out[row.classification] || 0) + 1; row.reasons.filter((reason) => reason !== row.classification).forEach((reason) => { out[reason] = (out[reason] || 0) + 1; }); return out; }, {}) };
};

const commitImport = async ({ token, auth = {}, requestId = "", service } = {}) => {
  const preview = previewStore.get(token);
  if (!preview || Date.now() - preview.createdAt > 15 * 60 * 1000) throw new AppError("Settlement import preview is missing or expired", 422, "SETTLEMENT_PREVIEW_INVALID");
  if (preview.rows.some((row) => row.classification !== "READY")) throw new AppError("Settlement import contains invalid rows", 422, "SETTLEMENT_IMPORT_INVALID");
  const created = [];
  for (const row of preview.rows) {
    const result = await service.create({ input: { settlementReference: row.settlementReference, provider: row.provider, providerSettlementReference: row.providerSettlementReference, receivedAmount: row.amount, receivedCurrency: row.currency, evidenceSource: "CSV_IMPORT", evidenceReference: row.evidenceReference }, auth, requestId });
    created.push({ settlementReference: row.settlementReference, replay: result.replay });
  }
  previewStore.delete(token);
  return { committed: created.length, rows: created };
};

const audit = ({ AuditLogModel = AuditLog, action, settlement, auth = {}, requestId = "", reason = "", before = null, after = null }) => AuditLogModel.create({
  actorId: auth.id || auth.email || null, actorRole: auth.role || "system", action, entityType: "Settlement", entityId: String(settlement?._id || ""), reference: settlement?.settlementReference || "", requestId, reason, before, after
});

const createSettlementService = ({ SettlementModel = Settlement, AllocationModel = SettlementAllocation, BookingModel = Booking, AuditLogModel = AuditLog } = {}) => {
  const recordAudit = (payload) => audit({ ...payload, AuditLogModel });
  const create = async ({ input, auth = {}, requestId = "" }) => {
    const provider = String(input.provider || "").toUpperCase();
    const evidenceSource = String(input.evidenceSource || "").toUpperCase();
    if (!PROVIDERS.has(provider)) throw new AppError("Unsupported settlement provider", 422, "SETTLEMENT_PROVIDER_INVALID");
    if (!EVIDENCE.has(evidenceSource) || !input.evidenceReference) throw new AppError("Settlement evidence reference is required", 422, "SETTLEMENT_EVIDENCE_REQUIRED");
    const key = input.idempotencyKey || idempotency({ provider, providerSettlementReference: input.providerSettlementReference || "", evidenceReference: input.evidenceReference });
    const existing = await SettlementModel.findOne({ idempotencyKey: key });
    if (existing) return { settlement: existing, replay: true };
    const gross = money(input.grossAmount, input.grossCurrency);
    const commission = money(input.commissionAmount, input.commissionCurrency || input.grossCurrency);
    const fees = money(input.feesAmount, input.feesCurrency || input.grossCurrency);
    const expected = input.expectedNetAmount !== undefined ? money(input.expectedNetAmount, input.expectedNetCurrency) : calculateExpectedSettlement({ gross, commission, fees, currency: input.grossCurrency }).expectedNet;
    let settlement;
    try {
      settlement = await SettlementModel.create({ settlementReference: input.settlementReference, provider, providerSettlementReference: input.providerSettlementReference || "", idempotencyKey: key, status: input.status || (expected ? "PENDING" : "NEEDS_REVIEW"), gross, commission, fees, expectedNet: expected, received: money(input.receivedAmount, input.receivedCurrency), settlementDate: input.settlementDate || null, receivedVia: input.receivedVia || "MANUAL", evidenceSource, evidenceReference: input.evidenceReference, adjustments: input.adjustments || [], notes: input.notes || "", createdBy: auth.id || auth.email || "" });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const canonical = await SettlementModel.findOne({ $or: [{ idempotencyKey: key }, { settlementReference: input.settlementReference }, { provider, providerSettlementReference: input.providerSettlementReference || "__none__" }] });
      if (!canonical) throw error;
      return { settlement: canonical, replay: true };
    }
    await recordAudit({ action: "SETTLEMENT_CREATED", settlement, auth, requestId, reason: "Settlement evidence recorded", after: { settlementReference: settlement.settlementReference, provider, status: settlement.status, received: settlement.received } });
    return { settlement, replay: false };
  };
  const list = async ({ page = 1, limit = 25, provider = "", status = "", currency = "", search = "" } = {}) => {
    const query = {}; if (provider) query.provider = String(provider).toUpperCase(); if (status) query.status = String(status).toUpperCase(); if (currency) query["expectedNet.currency"] = normalizeCurrency(currency); if (search) query.$or = [{ settlementReference: new RegExp(search, "i") }, { providerSettlementReference: new RegExp(search, "i") }];
    const safePage = Math.max(1, Number(page)); const safeLimit = Math.min(100, Math.max(1, Number(limit))); const [items, total] = await Promise.all([SettlementModel.find(query).sort({ settlementDate: -1, createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(), SettlementModel.countDocuments(query)]);
    return { items, page: safePage, pageSize: safeLimit, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) };
  };
  const detail = async (id) => { const settlement = await SettlementModel.findById(id).lean(); if (!settlement) throw new AppError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND"); const allocations = await AllocationModel.find({ settlementId: id, status: "APPLIED" }).sort({ createdAt: 1 }).lean(); const audits = await AuditLogModel.find({ entityType: "Settlement", entityId: String(id) }).sort({ createdAt: -1 }).limit(50).lean(); return { settlement, allocations, audits }; };
  const allocate = async ({ settlementId, bookingReference, amount, currency, purpose = "PAYOUT", auth = {}, requestId = "" }) => {
    const settlement = await SettlementModel.findById(settlementId); if (!settlement) throw new AppError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND"); const booking = await BookingModel.findOne({ bookingReference }).select("_id bookingReference").lean(); if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND"); const code = normalizeCurrency(currency); if (!code || code !== settlement.received?.currency && settlement.received?.currency) throw new AppError("Settlement allocation currency mismatch", 422, "CURRENCY_MISMATCH"); const allocationKey = `${settlementId}:${booking._id}:${purpose}`; const existing = await AllocationModel.findOne({ allocationKey }); if (existing && existing.status === "APPLIED") return { allocation: existing, replay: true }; const current = await AllocationModel.aggregate([{ $match: { settlementId: settlement._id, status: "APPLIED", currency: code } }, { $group: { _id: null, amount: { $sum: "$amount" } } }]); const allocated = toDecimal(current[0]?.amount || 0, { allowNegative: false }); const next = allocated.plus(toDecimal(amount, { allowNegative: false })); if (settlement.received?.amount && next.greaterThan(toDecimal(settlement.received.amount, { allowNegative: false }))) throw new AppError("Settlement allocations exceed received amount", 422, "SETTLEMENT_OVER_ALLOCATED"); const allocation = existing ? await AllocationModel.findOneAndUpdate({ _id: existing._id }, { $set: { amount, currency: code, status: "APPLIED", reversedAt: null, createdBy: auth.id || auth.email || "" } }, { new: true }) : await AllocationModel.create({ allocationKey, settlementId, bookingId: booking._id, bookingReference, amount, currency: code, purpose, createdBy: auth.id || auth.email || "" }); const updated = summarizeSettlement({ expectedNet: settlement.expectedNet, received: settlement.received, allocated: { amount: next.toFixed(), currency: code } }); await SettlementModel.updateOne({ _id: settlementId }, { $set: { allocated: { amount: next.toFixed(), currency: code }, unallocated: settlement.received ? { amount: toDecimal(settlement.received.amount, { allowNegative: false }).minus(next).toFixed(), currency: settlement.received.currency } : null, status: updated.status } }); await recordAudit({ action: "SETTLEMENT_ALLOCATED", settlement, auth, requestId, reason: "Settlement allocation recorded", after: { bookingReference, amount, currency: code } }); return { allocation, replay: false, status: updated.status };
  };
  const reconcile = async ({ settlementId, auth = {}, requestId = "" }) => { const current = await SettlementModel.findById(settlementId).lean(); if (!current) throw new AppError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND"); const allocation = current.allocated || null; const result = summarizeSettlement({ expectedNet: current.expectedNet, received: current.received, allocated: allocation }); await SettlementModel.updateOne({ _id: settlementId }, { $set: { status: result.status, unallocated: current.received && allocation ? { amount: toDecimal(current.received.amount, { allowNegative: false }).minus(toDecimal(allocation.amount, { allowNegative: false })).toFixed(), currency: current.received.currency } : null, lastReconciledAt: new Date() } }); await recordAudit({ action: result.status === "RECONCILED" ? "SETTLEMENT_RECONCILED" : "SETTLEMENT_MISMATCH", settlement: current, auth, requestId, reason: result.reason, after: result }); return { ...result, settlementId } };
  const reverseAllocation = async ({ allocationId, auth = {}, requestId = "", reason = "" }) => { const allocation = await AllocationModel.findById(allocationId); if (!allocation) throw new AppError("Settlement allocation not found", 404, "SETTLEMENT_ALLOCATION_NOT_FOUND"); if (allocation.status === "REVERSED") return { allocation, replay: true }; allocation.status = "REVERSED"; allocation.reversedAt = new Date(); allocation.reason = reason; await allocation.save(); await recordAudit({ action: "SETTLEMENT_ALLOCATION_REVERSED", settlement: { _id: allocation.settlementId }, auth, requestId, reason, after: { allocationId: String(allocation._id), status: "REVERSED" } }); return { allocation, replay: false }; };
  return { create, list, detail, allocate, reconcile, reverseAllocation, previewImport: (input) => previewImport({ ...input, SettlementModel, BookingModel }), commitImport: (input) => commitImport({ ...input, service: { create } }) };
};

const service = createSettlementService();
module.exports = { ...service, createSettlementService, calculateExpectedSettlement, summarizeSettlement, idempotency, parseCsv, previewImport, commitImport };

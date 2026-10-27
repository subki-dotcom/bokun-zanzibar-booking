// Sequential document numbers per year: INV-2026-00001, CN-2026-00001. Atomic, never reused.
const DocumentCounter = require("../../models/DocumentCounter");

const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;

const formatNumber = (prefix, year, seq) => `${prefix}-${year}-${String(seq).padStart(5, "0")}`;

const nextDocumentNumber = async (prefix = "INV", now = new Date()) => {
  const year = new Date(now.getTime() + ZANZIBAR_OFFSET_MS).getUTCFullYear();
  const counter = await DocumentCounter.findOneAndUpdate(
    { _id: `${prefix}-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return formatNumber(prefix, year, counter.seq);
};

module.exports = { nextDocumentNumber, formatNumber };

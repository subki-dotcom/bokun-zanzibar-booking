#!/usr/bin/env node
// Repairs historical records whose Data Quality issues can be resolved from evidence already stored on them.
// Nothing is inferred: every change is derived from the record's own stored fields.
//
//   node scripts/repair-financial-data-quality.js                 # dry run (default): report only
//   node scripts/repair-financial-data-quality.js --apply         # write changes + rollback file
//   node scripts/repair-financial-data-quality.js --rollback=<file>
//
// Production databases additionally require --confirm-production.
//
// Repairs:
//   1. Bokun operational dates whose stored raw Bokun text was never parsed (e.g. "Wed, September 23 2026 - 6:30 AM").
//   2. Missing salesChannel on bookings whose own sourceChannel identifies the channel.
//   3. Invoice balances on cancelled/failed bookings that the canonical invoice rule sets to 0.

const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const OPERATIONAL_DATE_FIELDS = ["travelDate", "activityDate", "bookingCreatedAtBokun", "bookingConfirmedAtBokun", "pickupDate"];

const parseArgs = (argv) => ({
  apply: argv.includes("--apply"),
  confirmProduction: argv.includes("--confirm-production"),
  rollback: (argv.find((arg) => arg.startsWith("--rollback=")) || "").slice("--rollback=".length),
  outputDir: (argv.find((arg) => arg.startsWith("--output-dir=")) || "").slice("--output-dir=".length) || "reports"
});

const planBookingRepairs = (booking, { normalizeOperationalDate, normalizeSalesChannel, SALES_CHANNEL }) => {
  const set = {};
  const before = {};
  const dates = booking.bokunOperationalDates || {};
  OPERATIONAL_DATE_FIELDS.forEach((field) => {
    const current = dates[field];
    if (!current?.raw || current.normalizedAt) return;
    const normalized = normalizeOperationalDate(current.raw);
    if (!normalized.normalizedAt) return;
    before[`bokunOperationalDates.${field}`] = current;
    set[`bokunOperationalDates.${field}`] = { ...current, ...normalized, raw: current.raw };
  });

  if (!booking.salesChannel && booking.sourceChannel) {
    const channel = normalizeSalesChannel(booking.sourceChannel);
    if (channel && channel !== SALES_CHANNEL.OTHER) {
      before.salesChannel = booking.salesChannel ?? null;
      set.salesChannel = channel;
    }
  }
  return Object.keys(set).length ? { set, before } : null;
};

const planInvoiceRepair = (invoice, { resolveInvoiceAccounting, bookingStatusClearsBalance }) => {
  if (!bookingStatusClearsBalance(invoice.bookingStatus)) return null;
  const storedBalance = Number(invoice.balanceDueAmount?.toString?.() ?? invoice.balanceDue ?? 0);
  if (!(storedBalance > 0.009)) return null;
  const resolved = resolveInvoiceAccounting({
    bookingStatus: invoice.bookingStatus,
    total: invoice.totalAmount?.toString?.() ?? invoice.total,
    verifiedPaidAmount: invoice.paidAccountingAmount?.toString?.() ?? invoice.amountPaid,
    confirmedRefundedAmount: invoice.refundedAccountingAmount?.toString?.() ?? invoice.amountRefunded
  });
  return {
    set: { balanceDue: resolved.balanceDue, balanceDueAmount: resolved.canonical.balanceDueAmount },
    before: { balanceDue: invoice.balanceDue ?? null, balanceDueAmount: invoice.balanceDueAmount?.toString?.() ?? null }
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is required.");
  if ((options.apply || options.rollback) && process.env.NODE_ENV === "production" && !options.confirmProduction) {
    throw new Error("Refusing to write to a production database without --confirm-production.");
  }

  const mongoose = require("mongoose");
  const { Decimal128 } = mongoose.Types;
  const { __testables: mapper } = require("../src/integrations/bokun/confirmedBooking.mapper");
  const { normalizeSalesChannel, SALES_CHANNEL } = require("../src/integrations/bokun/salesChannel.adapter");
  const { resolveInvoiceAccounting } = require("../src/services/invoices");
  const { bookingStatusClearsBalance } = require("../src/accounting/salesPolicy");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  try {
    if (options.rollback) {
      const plan = JSON.parse(fs.readFileSync(options.rollback, "utf8"));
      let restored = 0;
      for (const change of plan.changes) {
        const unset = {};
        const set = {};
        Object.entries(change.before).forEach(([key, value]) => {
          if (value === null || value === undefined) unset[key] = "";
          else set[key] = key === "balanceDueAmount" ? Decimal128.fromString(String(value)) : value;
        });
        await db.collection(change.collection).updateOne(
          { _id: new mongoose.Types.ObjectId(change.id) },
          { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }
        );
        restored += 1;
      }
      console.log(JSON.stringify({ mode: "rollback", restored, from: options.rollback }, null, 2));
      return;
    }

    const changes = [];
    const bookings = await db.collection("bookings")
      .find({}, { projection: { bookingReference: 1, bokunOperationalDates: 1, salesChannel: 1, sourceChannel: 1 } })
      .toArray();
    bookings.forEach((booking) => {
      const plan = planBookingRepairs(booking, { normalizeOperationalDate: mapper.normalizeOperationalDate, normalizeSalesChannel, SALES_CHANNEL });
      if (plan) changes.push({ collection: "bookings", id: String(booking._id), reference: booking.bookingReference, ...plan });
    });

    const invoices = await db.collection("invoices")
      .find({ bookingStatus: { $in: ["cancelled", "failed"] } })
      .toArray();
    invoices.forEach((invoice) => {
      const plan = planInvoiceRepair(invoice, { resolveInvoiceAccounting, bookingStatusClearsBalance });
      if (plan) changes.push({ collection: "invoices", id: String(invoice._id), reference: invoice.invoiceNumber, ...plan });
    });

    const summary = {
      mode: options.apply ? "apply" : "dry-run",
      database: db.databaseName,
      operationalDateRepairs: changes.filter((change) => Object.keys(change.set).some((key) => key.startsWith("bokunOperationalDates."))).length,
      salesChannelRepairs: changes.filter((change) => change.set.salesChannel).length,
      invoiceBalanceRepairs: changes.filter((change) => change.collection === "invoices").length,
      sample: changes.slice(0, 3)
    };

    if (options.apply && changes.length) {
      fs.mkdirSync(options.outputDir, { recursive: true });
      const rollbackFile = path.join(options.outputDir, `financial-data-quality-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      // The rollback file is written before any change so an interrupted run can still be reverted.
      fs.writeFileSync(rollbackFile, JSON.stringify({ createdAt: new Date().toISOString(), database: db.databaseName, changes }, null, 2));
      for (const change of changes) {
        const set = { ...change.set };
        if (set.balanceDueAmount !== undefined) set.balanceDueAmount = Decimal128.fromString(String(set.balanceDueAmount));
        await db.collection(change.collection).updateOne({ _id: new mongoose.Types.ObjectId(change.id) }, { $set: set });
      }
      summary.rollbackFile = rollbackFile;
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, planBookingRepairs, planInvoiceRepair };

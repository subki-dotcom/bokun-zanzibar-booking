require("dotenv").config();

const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Payment = require("../src/models/Payment");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const AuditLog = require("../src/models/AuditLog");
const {
  AUDIT_ACTION,
  TARGET,
  VERIFICATION_FIELDS,
  createLegacyPesapalVerificationRepair
} = require("../src/services/payments/legacyPesapalVerificationRepair");

const applyRequested = (args = []) => args.includes("--apply");
const parseArgs = (args = []) => ({
  apply: applyRequested(args),
  confirm: args.includes("--confirm"),
  approvalId: args.includes("--approval-id") ? args[args.indexOf("--approval-id") + 1] || "" : "",
  actorId: args.includes("--actor-id") ? args[args.indexOf("--actor-id") + 1] || "" : "",
  reason: args.includes("--reason") ? args[args.indexOf("--reason") + 1] || "" : ""
});

const resolveQuery = async (query, session) => {
  const sessionQuery = session && typeof query?.session === "function" ? query.session(session) : query;
  return sessionQuery && typeof sessionQuery.lean === "function" ? sessionQuery.lean() : sessionQuery;
};

const loadRepairEvidence = async ({ session = null, models = { Payment, Booking, Invoice } } = {}) => {
  const [payment, attempts, booking, invoice] = await Promise.all([
    resolveQuery(models.Payment.findById(TARGET.paymentId), session),
    resolveQuery(models.Payment.find({ provider: "pesapal", providerTransactionId: TARGET.orderTrackingId }), session),
    resolveQuery(models.Booking.findOne({ bookingReference: TARGET.bookingReference }), session),
    resolveQuery(models.Invoice.findOne({ bookingReference: TARGET.bookingReference }), session)
  ]);
  return { payment, attempts, booking, invoice };
};

const createMongoStore = ({ mongooseClient = mongoose, models = { Payment, Booking, Invoice, AuditLog } } = {}) => ({
  readEvidence: () => loadRepairEvidence({ models }),
  transaction: async (work) => {
    const session = await mongooseClient.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const transaction = {
          readEvidence: () => loadRepairEvidence({ session, models }),
          findRepairAudit: async (repairId) => resolveQuery(models.AuditLog.findOne({
            action: AUDIT_ACTION,
            entityType: "Payment",
            entityId: TARGET.paymentId,
            "metadata.repairId": repairId
          }), session),
          compareAndSetPayment: async (payment, fields) => {
            const filter = {
              _id: TARGET.paymentId,
              bookingReference: TARGET.bookingReference,
              intentId: payment.intentId,
              provider: "pesapal",
              status: "paid",
              providerTransactionId: TARGET.orderTrackingId,
              orderTrackingId: TARGET.orderTrackingId,
              updatedAt: payment.updatedAt,
              $and: VERIFICATION_FIELDS.map((field) => ({
                $or: [{ [field]: { $exists: false } }, { [field]: "" }, { [field]: null }, { [field]: fields[field] }]
              }))
            };
            const query = models.Payment.findOneAndUpdate(filter, { $set: fields }, { new: true, session });
            const updated = await resolveQuery(query, session);
            return Boolean(updated);
          },
          createAudit: async (audit) => models.AuditLog.create([audit], { session })
        };
        result = await work(transaction);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
});

const main = async (args = process.argv.slice(2)) => {
  const options = parseArgs(args);
  if (options.apply && !options.confirm) throw new Error("--confirm is required with --apply.");
  if (options.apply && !options.approvalId) throw new Error("--approval-id is required with --apply.");
  if (options.apply && !options.actorId) throw new Error("--actor-id is required with --apply.");
  if (options.apply && !options.reason) throw new Error("--reason is required with --apply.");

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  try {
    const repair = createLegacyPesapalVerificationRepair({ store: createMongoStore() });
    const result = options.apply
      ? await repair.run({
          apply: true,
          approvalId: options.approvalId,
          actorId: options.actorId,
          reason: options.reason
        })
      : await repair.run();
    console.log(JSON.stringify(result, null, 2));
    return result;
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

module.exports = { createMongoStore, loadRepairEvidence, main, parseArgs };

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const expected = {
  bookings: ["bokunBookingId_unique_nonempty"],
  invoices: ["bookingReference_unique_primary_invoice"],
  payments: ["provider_transaction_unique_nonempty", "provider_order_unique_nonempty"],
  paymentallocations: ["allocation_idempotency_unique"],
  refunds: ["provider_refund_unique_nonempty", "refund_idempotency_unique_nonempty"],
  providerwebhookevents: ["eventKey_unique_provider_event"]
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const verified = [];
  for (const [collection, names] of Object.entries(expected)) {
    const indexes = await mongoose.connection.db.collection(collection).indexes();
    for (const name of names) {
      const index = indexes.find((row) => row.name === name);
      verified.push({ collection, name, exists: Boolean(index), unique: index?.unique === true, key: index?.key || null, partialFilterExpression: index?.partialFilterExpression || null });
    }
  }
  const ok = verified.every((row) => row.exists && row.unique);
  console.log(JSON.stringify({ databaseName: mongoose.connection.name, ok, verified }, null, 2));
  if (!ok) process.exitCode = 2;
};
run().then(() => mongoose.disconnect()).catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });

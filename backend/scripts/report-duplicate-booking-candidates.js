// Read-only report of bookings that may describe the same real booking (see
// src/services/bookingIdentity/duplicateCandidates.js). It only runs find(): nothing is merged,
// deleted or rewritten. Prints JSON with booking references and reasons, no customer details.
//
// Usage: MONGO_URI=... node scripts/report-duplicate-booking-candidates.js --from 2026-01-01 --to 2026-12-31
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { FIELDS, findDuplicateCandidates } = require("../src/services/bookingIdentity/duplicateCandidates");

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
};
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  const from = argument("from");
  const to = argument("to");
  if (!isoDate.test(from) || !isoDate.test(to)) throw new Error("--from and --to travel dates (YYYY-MM-DD) are required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const bookings = await mongoose.connection.db
    .collection("bookings")
    .find({ travelDate: { $gte: from, $lte: to } }, { projection: Object.fromEntries(FIELDS.split(" ").map((field) => [field, 1])) })
    .toArray();
  const candidates = findDuplicateCandidates(bookings);
  console.log(JSON.stringify({ databaseName: mongoose.connection.name, travelDates: { from, to }, scanned: bookings.length, candidates }, null, 2));
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });

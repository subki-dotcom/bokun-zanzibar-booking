const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Settlement = require("../src/models/Settlement");
const SettlementAllocation = require("../src/models/SettlementAllocation");
const EXPECTED_DATABASE = "bokun_zanzibar_booking";

async function main() {
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify({ dryRun: true, indexes: ["Settlement", "SettlementAllocation"] })); return; }
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required from backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const databaseName = mongoose.connection.db.databaseName;
  if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);
  const settlementIndexes = await Settlement.createIndexes();
  const allocationIndexes = await SettlementAllocation.createIndexes();
  console.log(JSON.stringify({ connected: true, databaseName, settlementIndexes, allocationIndexes, recordsChanged: 0 }));
  await mongoose.disconnect();
}
main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });

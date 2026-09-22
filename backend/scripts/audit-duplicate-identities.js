const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { runDuplicateAudit } = require("../src/services/identityAudit");

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const report = await runDuplicateAudit();
  const output = path.resolve(process.cwd(), process.argv.find((v) => v.startsWith("--output="))?.slice(9) || "../reports/duplicate-identity-audit.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, totalConflictGroups: report.totalConflictGroups, mode: report.mode }));
};
run().then(() => mongoose.disconnect()).catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });

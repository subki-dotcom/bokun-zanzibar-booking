require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const ProductCostTemplate = require("../src/models/ProductCostTemplate");

const EXPECTED_DATABASE = "bokun_zanzibar_booking";

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const run = async () => {
  if (process.argv.includes("--apply")) {
    throw new Error("This planner is dry-run only. Template isolation requires explicit reviewed approval.");
  }

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const databaseName = mongoose.connection.db.databaseName;
  if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);

  const templates = await ProductCostTemplate.find({ status: "active" })
    .select("_id name description bokunProductId bokunOptionId currency status validFrom validTo updatedAt")
    .sort({ validFrom: 1, updatedAt: 1 })
    .lean();
  const rows = templates
    .filter((template) => /\btest\b/i.test(`${template.name || ""} ${template.description || ""}`))
    .map((template) => ({
      templateId: String(template._id),
      name: template.name || "",
      description: template.description || "",
      bokunProductId: template.bokunProductId || "",
      bokunOptionId: template.bokunOptionId || "",
      currency: template.currency || "",
      status: template.status,
      validFrom: template.validFrom || null,
      validTo: template.validTo || null,
      updatedAt: template.updatedAt || null,
      action: "REVIEW_REQUIRED_ISOLATION",
      reason: "ACTIVE_TEMPLATE_MARKED_TEST"
    }));
  const report = {
    readOnly: true,
    dryRun: true,
    databaseName,
    generatedAt: new Date().toISOString(),
    scannedActiveTemplates: templates.length,
    candidateCount: rows.length,
    writes: 0,
    rows
  };
  const output = valueAfter("--output", "");
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    report.output = outputPath;
  }
  console.log(JSON.stringify(report, null, 2));
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });

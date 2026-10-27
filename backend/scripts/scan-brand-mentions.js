#!/usr/bin/env node
// Read-only scan of the database for old brand mentions ("Riser", the old domain, phone and email).
// It never writes. Prints, per collection and field, how many documents match and one short example.
//
//   node scripts/scan-brand-mentions.js                      # all collections
//   node scripts/scan-brand-mentions.js --skip auditlogs     # skip some (comma-separated)
//   node scripts/scan-brand-mentions.js --json > scan.json   # machine-readable
require("dotenv").config();
const mongoose = require("mongoose");

const PATTERN = /riser|risertoursandsafaris|778[\s-]?775[\s-]?044/i;
const args = process.argv.slice(2);
const skip = new Set(
  String(args[args.indexOf("--skip") + 1] || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name && args.includes("--skip"))
);
const asJson = args.includes("--json");

// Field paths whose string value matches, e.g. "description", "options.0.name" → "options.name".
const matches = (value, path = "", found = new Map()) => {
  if (typeof value === "string") {
    if (PATTERN.test(value)) {
      const key = path.replace(/\.\d+(?=\.|$)/g, "") || "(value)";
      if (!found.has(key)) found.set(key, value);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => matches(item, `${path}.${index}`, found));
  } else if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value) && !value._bsontype) {
    Object.entries(value).forEach(([key, item]) => matches(item, path ? `${path}.${key}` : key, found));
  }
  return found;
};

// A short example around the match, with emails and long digit runs masked.
const sample = (text) => {
  const value = String(text);
  const at = value.search(PATTERN);
  return value
    .slice(Math.max(0, at - 40), at + 60)
    .replace(/\s+/g, " ")
    .replace(/[^\s@]+@[^\s@]+/g, (email) => `${email[0]}•••@${email.split("@")[1]}`)
    .replace(/\d{6,}/g, (digits) => `${"•".repeat(digits.length - 3)}${digits.slice(-3)}`);
};

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
  const report = [];
  for (const name of collections) {
    if (skip.has(name.toLowerCase()) || name.startsWith("system.")) continue;
    const fields = new Map();
    let scanned = 0;
    let documents = 0;
    for await (const doc of db.collection(name).find({}, { batchSize: 500 })) {
      scanned += 1;
      const found = matches(doc);
      if (!found.size) continue;
      documents += 1;
      found.forEach((value, field) => {
        const entry = fields.get(field) || { field, documents: 0, example: sample(value) };
        entry.documents += 1;
        fields.set(field, entry);
      });
    }
    if (documents) report.push({ collection: name, scanned, documents, fields: [...fields.values()].sort((a, b) => b.documents - a.documents) });
    if (!asJson) process.stderr.write(`scanned ${name} (${scanned})\n`);
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!report.length) {
    console.log("\nNo old brand mentions found.");
  } else {
    console.log("\nOld brand mentions (read-only scan, nothing changed):");
    report.forEach((item) => {
      console.log(`\n${item.collection}: ${item.documents} of ${item.scanned} documents`);
      item.fields.forEach((field) => console.log(`  ${field.field} (${field.documents}) – "${field.example}"`));
    });
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

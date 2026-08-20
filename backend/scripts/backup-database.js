#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const parseArgs = (argv) => {
  const parsed = {
    dryRun: true,
    apply: false,
    outputDir: process.env.DR_BACKUP_DIRECTORY || "backups/mongodb"
  };

  argv.forEach((arg) => {
    if (arg === "--apply") {
      parsed.apply = true;
      parsed.dryRun = false;
      return;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.apply = false;
      return;
    }
    if (arg.startsWith("--output-dir=")) parsed.outputDir = arg.slice("--output-dir=".length);
  });

  return parsed;
};

const sanitizeFilenamePart = (value = "") =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "database";

const extractDatabaseName = (uri = "") => {
  try {
    const parsed = new URL(uri);
    const name = decodeURIComponent(String(parsed.pathname || "").replace(/^\//, "").split("/")[0] || "");
    return sanitizeFilenamePart(name || "admin");
  } catch (_error) {
    const match = String(uri || "").match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
    return sanitizeFilenamePart(match?.[1] || "unknown");
  }
};

const maskMongoUri = (uri = "") =>
  String(uri || "")
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/i, "$1[redacted]:[redacted]@")
    .replace(/([?&](?:authSource|replicaSet|tlsCertificateKeyFilePassword|password)=)[^&]+/gi, "$1[redacted]");

const redactArgs = (args = []) =>
  args.map((arg) => arg.startsWith("--uri=") ? `--uri=${maskMongoUri(arg.slice("--uri=".length))}` : arg);

const run = ({ command, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const error = new Error(`${command} exited with code ${code}`);
      error.exitCode = code;
      return reject(error);
    });
  });

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error("BACKUP_MONGO_URI_REQUIRED: MONGO_URI must be set before creating a backup plan.");
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const databaseName = extractDatabaseName(mongoUri);
  const archivePath = path
    .join(
      options.outputDir,
      `${databaseName}-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.archive.gz`
    )
    .replace(/\\/g, "/");
  const args = [`--uri=${mongoUri}`, `--archive=${archivePath}`, "--gzip"];

  console.log(JSON.stringify({
    type: "BACKUP",
    mode: options.apply ? "apply" : "dry-run",
    databaseName,
    archivePath,
    command: "mongodump",
    args: redactArgs(args),
    note: options.apply
      ? "Executing mongodump. Verify this archive is copied to encrypted off-host storage."
      : "Dry-run only. No backup file will be written."
  }, null, 2));

  if (!options.apply) return;

  fs.mkdirSync(options.outputDir, { recursive: true });
  await run({ command: "mongodump", args });
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
});

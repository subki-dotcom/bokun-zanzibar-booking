#!/usr/bin/env node

const { spawn } = require("node:child_process");
require("dotenv").config();

const parseArgs = (argv) => {
  const parsed = {
    dryRun: true,
    apply: false,
    archivePath: "",
    targetUri: "",
    confirmRestore: false,
    allowProductionRestore: false,
    dropExisting: false
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
    if (arg === "--confirm-restore") parsed.confirmRestore = true;
    if (arg === "--allow-production-restore") parsed.allowProductionRestore = true;
    if (arg === "--drop-existing") parsed.dropExisting = true;
    if (arg.startsWith("--archive=")) parsed.archivePath = arg.slice("--archive=".length);
    if (arg.startsWith("--target-uri=")) parsed.targetUri = arg.slice("--target-uri=".length);
  });

  return parsed;
};

const maskMongoUri = (uri = "") =>
  String(uri || "")
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/i, "$1[redacted]:[redacted]@")
    .replace(/([?&](?:authSource|replicaSet|tlsCertificateKeyFilePassword|password)=)[^&]+/gi, "$1[redacted]");

const redactArgs = (args = []) =>
  args.map((arg) => arg.startsWith("--uri=") ? `--uri=${maskMongoUri(arg.slice("--uri=".length))}` : arg);

const fail = (code, message) => {
  console.error(`${code}: ${message}`);
  process.exitCode = 1;
};

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
  const args = [];
  if (options.targetUri) args.push(`--uri=${options.targetUri}`);
  if (options.archivePath) args.push(`--archive=${options.archivePath}`);
  args.push("--gzip");
  if (options.dropExisting) args.push("--drop");

  const missing = [];
  if (!options.archivePath) missing.push("RESTORE_ARCHIVE_REQUIRED");
  if (!options.targetUri) missing.push("RESTORE_TARGET_URI_REQUIRED");
  if (options.apply && !options.confirmRestore) missing.push("CONFIRM_RESTORE_REQUIRED");
  if (
    options.apply &&
    process.env.NODE_ENV === "production" &&
    !(process.env.DR_ALLOW_PRODUCTION_RESTORE === "true" && options.allowProductionRestore)
  ) {
    missing.push("PRODUCTION_RESTORE_BLOCKED");
  }

  console.log(JSON.stringify({
    type: "RESTORE",
    mode: options.apply ? "apply" : "dry-run",
    archivePath: options.archivePath,
    targetUriRedacted: maskMongoUri(options.targetUri),
    command: "mongorestore",
    args: redactArgs(args),
    dropExisting: options.dropExisting,
    missingRequirements: missing,
    note: options.apply
      ? "Executing mongorestore against the requested target URI."
      : "Dry-run only. No database restore will be executed."
  }, null, 2));

  if (missing.length) {
    fail("RESTORE_EVIDENCE_REQUIRED", `Cannot ${options.apply ? "apply" : "plan"} restore until requirements are satisfied: ${missing.join(", ")}`);
    return;
  }

  if (!options.apply) return;

  await run({ command: "mongorestore", args });
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
});

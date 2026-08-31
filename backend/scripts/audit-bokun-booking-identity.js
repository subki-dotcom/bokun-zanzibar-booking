#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

// Lightweight CLI: load dotenv (if present) and connect to MongoDB directly
try {
  require('dotenv').config({ path: path.resolve(process.cwd(), 'backend', '.env') });
} catch (e) {
  try { require('dotenv').config(); } catch (__) {}
}

const mongoose = require('mongoose');
const { runAuditCLI } = require('../src/scripts/bokunIdentityAudit');

async function connectLocal() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing required environment variable: MONGO_URI');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { maxPoolSize: 5 });
}

const run = async () => {
  try {
    await connectLocal();
    const outDir = process.argv[2] || undefined;
    const result = await runAuditCLI({ outDir });
    console.log('Done. Report path:', result.filePath);
    process.exit(0);
  } catch (err) {
    console.error('Audit failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
};

run();

#!/usr/bin/env node
const path = require('path');
// Lightweight CLI: load dotenv (if present) and connect to MongoDB directly
try {
  require('dotenv').config({ path: path.resolve(process.cwd(), 'backend', '.env') });
} catch (e) {
  try { require('dotenv').config(); } catch (__) {}
}

const mongoose = require('mongoose');
const { findDuplicateKeys, createUniqueSparseIndex } = require('../src/scripts/bokunIdentityMigrate');

const SUPPORTED_KEYS = ['bokunBookingId', 'bokunConfirmationCode'];

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
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const keyArg = args.find((a) => a.startsWith('--key='));
  const key = keyArg ? keyArg.split('=')[1] : 'bokunBookingId';

  if (!SUPPORTED_KEYS.includes(key)) {
    console.error('Unsupported key. Supported:', SUPPORTED_KEYS.join(', '));
    process.exit(2);
  }

  try {
    await connectLocal();
    const duplicates = await findDuplicateKeys({ key });
    if (duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate ${key} values. Example:`, duplicates[0]);
      if (apply) {
        console.error('Refusing to apply index while duplicates exist. Resolve duplicates first.');
        process.exit(3);
      } else {
        console.log('Dry-run: run with --apply after resolving duplicates to create unique sparse index.');
        process.exit(0);
      }
    }

    console.log('No duplicates found for', key);
    if (apply) {
      console.error('No duplicates found but --apply not allowed from maintenance CLI without explicit confirmation.');
      process.exit(2);
    } else {
      console.log('Dry-run: no changes made. Re-run with --apply to create the unique sparse index (after review).');
    }

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
};

run();

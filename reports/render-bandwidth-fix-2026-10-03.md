# Render bandwidth correction — 2026-10-03

Status: implemented and tested locally; not committed, pushed or deployed.

## Evidence and scope

Render showed 7.3 GB service-initiated traffic versus 12 MB HTTP responses for October at inspection. Read-only socket diagnostics showed about 1.16 GB acknowledged outbound traffic on existing port 27017 connections. These counters do not attribute the entire September bill or individual job costs.

Production startup logs showed both Bókun polling and confirmed-booking import configured for 60-second scheduling. No production settings or scheduling intervals were changed.

## Changes

- `backend/src/config/db.js`: request MongoDB's built-in zlib wire compression at level 3, negotiated by the driver. No new dependency or database migration.
- `backend/src/utils/applyChangedFields.js`: skip equal values and assign changed schema-defined nested fields individually. Mixed supplier payloads and arrays remain atomic. Timestamps and real changes are preserved.
- `backend/src/services/bokunConfirmedBookings/index.js`: use this assignment for existing bookings, duplicate-create recovery, and cancellation synchronization. Existing save, validation, audit and payment processing remain in place.
- `backend/test/bokunWriteBandwidth.test.js`: real Mongoose document/change tracking tests for payload size, final-state parity, nested removals, nulls, arrays, changed evidence and unrelated pending edits.
- `backend/test/dbCompression.test.js`: verify connection options using the installed MongoDB driver's option parser, without connecting to a database; preserve index initialization.

## Validation

71 tests passed across compression, write bandwidth, Bókun import, polling concurrency, worker, webhook, sync status, financial evidence, currency pipeline, payment mapping/sync and payment recovery suites. Tests used dummy local environment values; no production database connection or mutation was performed.

A synthetic unchanged-evidence heartbeat produced a 200,919-byte update using the previous assignment, versus 71 bytes with the correction. Final documents were deeply equal. This is an uncompressed JSON representation of Mongoose's update, not a measured production wire transfer or savings forecast.

Syntax and diff checks passed. ESLint passed for the utility and importer. `db.js` retains its pre-existing `no-process-exit` lint error in the unchanged error handler. One initial financial-evidence test run lacked required dummy environment variables; the complete 71-test rerun passed with those supplied.

## Rollout and limits

Deploy only the five code/test files above after approval, excluding existing unrelated workspace edits. After deployment verify startup, successful import/cancellation sync, and reduced service-initiated bandwidth over comparable periods. Check CPU impact and negotiated compression before claiming savings. Existing writes for timestamps, payment evidence and necessary audit operations are not all eliminated. Paid booking, settlement, accounting, pricing and payment-status rules were not changed.

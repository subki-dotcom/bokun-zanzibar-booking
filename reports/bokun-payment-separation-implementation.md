# Bókun customer payment separation

## Architecture and ownership

- Bókun is authoritative for the operational customer-payment state of every Bókun-linked booking, regardless of sales channel.
- `Payment`, `PaymentAllocation`, invoice accounting balances, refunds, journals, the general ledger and cash flow remain local accounting evidence.
- A Bókun `PAID` state never creates a local payment, refund, allocation, journal or settlement record.

## Verified supplier evidence and mapping

The persisted and live Bókun booking responses expose booking-level `paymentType`, `totalPaid`, `totalPrice`, `totalDue` and `currency`. The canonical mapper gives booking-level fields priority and does not infer payment from GetYourGuide, Viator, Direct or any other channel name.

- `PAID_IN_FULL` / `PAID`, or paid amount equal to total: `PAID`
- `PARTIALLY_PAID`, or paid amount between zero and total: `PARTIALLY_PAID`
- `NOT_PAID` / `UNPAID`, or a zero paid amount with a known positive total: `UNPAID`
- Explicit payment-field `REFUNDED`: `REFUNDED`
- Missing, invalid, contradictory or unknown evidence: `UNKNOWN`

Cancellation and negative balances do not manufacture refund truth. Supplier invoice totals are only a fallback for the booking total; they are not treated as customer-payment or settlement proof.

## Data model and synchronization

`Booking` now stores canonical status, source, reported paid amount/currency, sync time, an evidence hash, sanitized Bókun evidence, conflict state and a durable pending-audit outbox. Locked manual overrides require an audit reference. A conflicting Bókun state is retained for review instead of silently replacing the override.

One idempotent synchronization service is called by confirmed-booking import, cancellation import and webhook/poll processing. It uses optimistic compare-and-set writes, evidence hashing and a unique audit event key. Payment-only webhook changes do not rebuild accounting invoices.

## API and UI behavior

Invoice lists/details, recent booking APIs, Booking Management, the admin dashboard, Booking Accounting and Business Intelligence now expose customer payment and local settlement separately. Invoice totals retain their established accounting definitions. CSV exports label customer-payment, source, channel, settlement and local-accounting fields separately.

Settlement is projected from existing verified local `Payment` and applied `PaymentAllocation` evidence using two batch reads. `RECEIVED` requires a dated provider settlement or a verified applied manual cash/bank receipt. The current models do not prove bank reconciliation or expected net channel payout, so those metrics are explicitly unavailable.

## Historical audit and dry run

The read-only audit found 76 Bókun-linked bookings. The live Bókun dry run proposed 41 `PAID` and 35 `UNPAID`: GetYourGuide 14 paid, Viator 10 paid, Direct Website 4 paid, and Other 13 paid / 35 unpaid. It found no mapping conflicts. The dry run made no accounting or booking writes.

Artifacts:

- `reports/bokun-payment-audit.json`
- `reports/bokun-payment-backfill-dry-run.json`

Historical apply is deliberately gated by `--review <dry-run-report>` and rechecks live evidence and the previous evidence hash. No historical apply was run; the dry-run artifact must be reviewed first.

## Verification

- Backend: 401 tests passed, including real isolated-Mongo concurrency, durable audit retry, override races, canonical-only mutation and no Payment/Refund/Invoice/Journal creation.
- Frontend: 104 tests passed.
- Frontend production build passed. Vite reports the pre-existing large-chunk warning.
- Authenticated runtime checks returned HTTP 200 for analytics payment overview, booking-accounting payment overview, invoice list/detail and recent bookings.
- Backend lint could not run because the local backend install does not contain an executable ESLint binary, although the script is declared.

## Deployment state

This implementation is present in the local working tree. It has not been committed, pushed to GitHub or deployed to Render/Vercel. The production application will not receive this behavior until the repository changes are deployed.

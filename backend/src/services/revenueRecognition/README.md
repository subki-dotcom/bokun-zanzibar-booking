# Revenue Recognition v1

Owner policy: USD functional currency; earned service revenue only after verified completion; OTA revenue is verified supplier net, without another commission deduction. Profitability and Booking Expenses are separate and unchanged.

## Entry points

- `serviceCompletion.create` evaluates a new completion when the revenue flag is enabled. Replays may retry the same event.
- The revenue retry worker revisits bounded batches of post-activation completion events. It does not infer completion from a date, invoice, payment or settlement.
- Both revenue preview screens use this service's policy and deterministic posting identity.
- The legacy invoice-gross journal helper refuses new postings.
- `POST /api/admin/service-completions/:completionId/revenue-post` retries the guarded automatic path. Request bodies cannot override the flag, activation boundary or evidence checks.
- `POST .../:completionId/revenue-evidence` requires the existing GL approval permission. It records approved FX/component allocation evidence with actor, date, reason and reference. It cannot alter posted evidence.
- `POST .../:completionId/revenue-reverse` requires the existing revenue reversal permission. It creates a compensating journal; it never deletes or modifies original journal evidence.

## Activation is deliberately unconfigured

The application `.env` was not edited and automatic revenue posting was not activated.

Required settings:

```
ACCOUNTING_BASE_CURRENCY=USD
REVENUE_RECOGNITION_AUTOMATIC_ENABLED=false
REVENUE_RECOGNITION_ACTIVATED_AT=
REVENUE_RECOGNITION_ACTIVATION_SCOPE=NEW_COMPLETIONS
```

An owner-approved explicit UTC ISO timestamp and the literal `NEW_COMPLETIONS` scope are required. Startup never generates or advances the timestamp.

- `NEW_COMPLETIONS`: completion creation, verification and actual completion must each be strictly after the timestamp. A booking may have been created before activation.

Missing/invalid/future boundaries block posting. The worker does not query when the flag, timestamp or scope is missing. Per-event checks also run inside the posting transaction. There is no historical backfill or startup posting pass.

Before activation, run `npm run check:revenue-readiness`. It performs read-only topology, index and account-mapping checks. Automatic posting requires replica-set/mongos transaction topology, unique recognition indexes, active required GL mappings, and the explicit activation boundary; it fails closed otherwise. Required account mappings are Tour Revenue, Customer/GYG/Viator/OTA receivables, FX gain/loss, Refund Allowance and Refund Payable. This implementation does not seed or change live account mappings.

## Evidence and journals

Direct selling amounts come only from `pricingSnapshot.finalPayable` with its own known currency, never `booking.amount`. Customer identity must be supported by the booking. OTA amounts come from stored verified supplier/seller-invoice evidence with currency and provenance; gross-only evidence is unknown and blocked.

Normal journal: debit customer AR or OTA/reseller AR, credit service revenue. OTA-specific mappings must not resolve to generic customer AR. Recognizing a receivable does not create a Payment, Settlement or bank receipt.

Supported USD prepayments release an existing complete posted deposit balance. A paid flag/allocation alone is insufficient. Unsupported, excessive or foreign-currency prepayments require review; this module does not invent historical deposit journals.

Package/component recognition requires an approved allocation plan summing to the authoritative booking revenue basis. Each service key has one immutable recognition identity. Later components must use the same allocation plan. Unknown package allocation blocks recognition.

Non-USD revenue requires approved FX evidence matching the UTC completion date, including original/target currency, positive rate, source and approver/reference. The original amount/currency/rate/source/date and USD equivalent remain in recognition and journal evidence. Settlement never rewrites recognized revenue. Settlement FX gain/loss posting is outside this module and is not fabricated.

Zero is distinct from unknown: a valid zero event records ZERO_REVENUE without a zero-value GL journal.

## Atomicity and idempotency

The MongoDB transaction uses snapshot reads and majority writes. It includes booking/component serialization, the unique recognition record, complete journal header and lines, completion posting state and audit log. Any failure rolls back the entire transaction. No nontransactional fallback exists.

Identity is a deterministic hash of booking ID and service key with a v1 namespace. The unique RevenueRecognition.postingKey and JournalEntry.source.postingKey indexes are initialized during database startup and checked before mutation. The readiness command only inspects indexes; it never rebuilds or drops production indexes.

The existing generic ledger paths for other modules are not rewritten. Revenue does not use their former non-atomic source-event writer.

## Adjustments and review

Cancellation, no-show, refund, contradictory evidence, missing party/mapping/period and other unresolved financial states block normal recognition. Cancellation after service does not erase posted revenue. No-show/cancellation retained fees remain NEEDS_REVIEW unless a separately evidenced accounting treatment is established; no fee is guessed.

Completion reversal records a review requirement without deleting the journal. Authorized revenue correction requires a reason/reference, open posting period, original recognition link and evidenced balance treatment. Refund correction requires a matching approved/confirmed refund, original-currency amount, and an additional supplier adjustment reference for OTA revenue. Cumulative corrections cannot exceed the recognized amount or supported refund amount; AR corrections cannot exceed open AR. Partial corrections use historical recognition FX and the final correction absorbs rounding residue. Original journals remain unchanged.

Review statuses and blockers are visible on the completion record and canonical preview. Evidence corrections can be retried without creating another recognition event.

## Validation

From `backend`:

```
node scripts/test-revenue-recognition.js
node scripts/test-revenue-recognition.js --full
```

The runner creates a disposable localhost MongoDB replica set on a random port. It never loads application `.env`, uses a separate generated database name, and removes only its own temporary files/database. It requires a local `mongod` executable (`REVENUE_TEST_MONGOD` can provide its path). Tests use fixtures and never call live OTA/payment APIs.

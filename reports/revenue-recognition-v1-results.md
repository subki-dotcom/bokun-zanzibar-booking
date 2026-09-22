# Revenue Recognition v1 implementation results

Implementation follows the supplied owner policy. Automatic posting has NOT been activated. The owner has not selected an activation scope/timestamp; neither is inferred from the current date, deployment or a restart.

## Behavior

| Requirement | Implemented result |
|---|---|
| Recognition trigger | Verified completion of the identified booking/service component. Booking, invoice, payment, OTA paid status and elapsed travel date do not earn revenue. |
| Direct revenue | Uses authoritative pricingSnapshot.finalPayable and its currency, with customer identity evidence. No booking.amount fallback. Unpaid earned service debits customer AR. |
| GYG | Verified 14.96 USD supplier revenue produces 14.96 USD OTA AR and revenue. No second 7.04 USD commission expense. |
| Viator | Verified 115.60 USD supplier revenue produces 115.60 USD Viator AR and revenue. No inferred commission percentage. Gross-only evidence blocks posting. |
| Other OTA | Same stored supplier-evidence rules, explicit reseller identity and OTA_RECEIVABLE mapping. Unproven provider/amount/currency blocks posting. |
| Receivable party | Customer AR for direct; GYG/Viator/provider-neutral OTA AR for reseller obligations. OTA mappings cannot resolve to generic customer AR. |
| Completion evidence | Supported evidence source, actor, verification/completion dates, booking match and reason/reference. No future completion. Admin verification requires accounting approval permission. Contradictions, including stored OTA refund/no-show evidence, block normal recognition. |
| Multi-service | Approved allocation plan sums to authoritative booking basis. Only the completed component is recognized. Later components must retain the same allocation plan. Unknown allocations require review. |
| Cancellation/no-show | Blocks normal service revenue. Cancellation after service does not erase existing revenue. Unproven retained fees remain under review; no fee revenue is guessed. |
| Full/partial refund | Authorized, evidence-linked compensating entries. Verified amount and cumulative limits; only the appropriate partial amount is reversed. Original journals are unchanged. |
| Completion reversal | Changes completion to reversed and opens accounting review. A separate authorized correction creates the compensating journal. |
| FX | USD ledger entries; original amount/currency, approved rate/source/date and USD value are retained. Foreign revenue without completion-date FX enters NEEDS_REVIEW_FX. Settlement does not rewrite revenue. |
| Prepayments | Supported USD posted deposits are released instead of creating duplicate AR. Unclassified/foreign/excessive deposits require review. Payment flags alone are not deposit or cash evidence. |
| Atomicity | Recognition record, journal header, all lines, completion state and audit commit in one MongoDB transaction, using snapshot reads and majority writes. Errors roll back everything. No nontransactional fallback. |
| Idempotency | Deterministic booking/service key; existing unique recognition and journal posting indexes; booking/component serialization; retries reuse the existing recognition. Reversal references are independently idempotent and cumulatively capped. |
| Zero revenue | Verified ZERO_REVENUE recognition record without a zero-value journal. Missing amount remains unknown/review. |
| Review | Missing/contradictory evidence, financial issues, identity, mapping, period, FX or activation prerequisites fail closed. Review blockers are exposed in previews and completion state. Failed adjustment requests include NEEDS_REVIEW and postingAllowed=false. |
| Audit | Booking/component, basis/provenance, original currency/amount, FX, completion evidence, policy, origin, date, actor and journal link. No full customer/booking payload copied into journal evidence. |

All preview entry points now use the canonical revenue policy. The legacy invoice-gross posting helper is disabled. This new revenue transaction path does not rewrite frozen expense posting or the generic journal workflows of other modules.

## Automatic posting and exact activation boundary

Current configuration/defaults:

- REVENUE_RECOGNITION_AUTOMATIC_ENABLED=false.
- REVENUE_RECOGNITION_ACTIVATED_AT is empty.
- REVENUE_RECOGNITION_ACTIVATION_SCOPE is empty.
- The application .env was not edited and the running application was not restarted for activation.

Consequently **there is no active posting boundary and no automatic revenue posting was enabled**.

Supported explicit scopes:

1. NEW_BOOKINGS_AND_COMPLETIONS: booking creation, known original imported booking creation, completion creation, verification and actual completion must all be on/after the approved UTC timestamp.
2. NEW_COMPLETIONS: completion creation, verification and actual completion must all be on/after the approved UTC timestamp; older-created bookings may qualify. This option requires explicit owner selection.

The timestamp must be an explicit UTC ISO value, not a startup-generated date. The new worker cannot query history when configuration is missing. Each event rechecks the boundary inside its transaction. There is no historical backfill or startup posting pass.

Before actual activation, the remaining requirements are: owner selection of scope/timestamp and read-only verification of the target deployment's transaction support, unique indexes and active OTA/revenue mappings. No live index or mapping migration was performed.

Clean bookings do not require individual approval. Supplemental FX/component allocations and controlled reversals reuse existing accounting approval permissions. Customer payment and OTA settlement remain separate modules; no cash or settlement is fabricated.

## Validation

| Check | Final result |
|---|---|
| Focused revenue policy + real MongoDB integration | 31 passed, 0 failed, 0 skipped |
| API/worker/completion compatibility group | 19 passed, 0 failed |
| Journal/GL/Booking Accounting/Profitability/Booking Expenses group | 102 passed, 0 failed |
| Full backend with real revenue integration enabled | 599 total: 597 passed, 2 environment-gated skipped, 0 failed |
| Frontend tests | 144 passed, 0 failed |
| Frontend production build | Passed; large-chunk warning |
| Changed-file lint | Passed: 0 errors, 2 existing warnings |
| Frozen-module SHA-256 comparison | 12 selected source/test files unchanged |

The final source was checked by the full backend run after the last policy changes. Frontend source was unchanged; its tests/build were run because backend UI/API contracts were affected.

- Focused real-database tests: reports/revenue-recognition-focused-tests.txt.
- API/worker/completion compatibility: reports/revenue-recognition-api-worker-tests.txt.
- Journal/GL/Booking Accounting/Profitability/Booking Expenses regressions: reports/revenue-recognition-accounting-regressions.txt.
- Full backend: reports/revenue-recognition-full-backend.txt.
- Frontend tests/build: reports/revenue-recognition-frontend-tests.txt and reports/revenue-recognition-frontend-build.txt.
- Changed-file lint: reports/revenue-recognition-lint.txt.
- Frozen-module hash evidence: reports/revenue-recognition-frozen-module-check.json.

Database integration tests use a disposable localhost MongoDB replica set, random port and generated database. They test concurrent requests, duplicate retries, invisible uncommitted writes and failures after the journal header, during lines and before commit. The actual GL P&L is exercised using the resulting revenue lines. No application database or live provider APIs are used.

The full backend suite's two environment-gated skips are the pre-existing booking-payment Mongo integration and BI Mongo integration tests. Revenue integration tests run and are not skipped under the dedicated runner.

Lint has no errors; the two existing unused-variable warnings are BusinessIncomeModel in generalLedger/ledger.js and GL_ACCOUNT_TYPE in generalLedgerCore.test.js. Both declarations also occur unused in HEAD. The frontend build reports a large-chunk warning; no frontend source was changed.

## Files changed by this task

New code/tests:

- backend/src/services/revenueRecognition/policy.js
- backend/src/services/revenueRecognition/index.js
- backend/src/services/revenueRecognition/README.md
- backend/src/jobs/revenueRecognition.job.js
- backend/scripts/test-revenue-recognition.js
- backend/test/revenueRecognitionPolicy.test.js
- backend/test/revenueRecognition.integration.test.js
- backend/test/revenueRecognitionWorker.test.js
- backend/test/revenueRecognitionRoutes.test.js

Updated existing files, preserving prior workspace changes:

- backend/.env.example
- backend/server.js
- backend/src/config/env.js
- backend/src/accounting/constants.js
- backend/src/models/ServiceCompletion.js
- backend/src/models/RevenueRecognition.js
- backend/src/services/serviceCompletion/index.js
- backend/src/services/customerAccounting/index.js
- backend/src/services/generalLedger/ledger.js
- backend/src/services/glPosting/preview.js
- backend/src/controllers/accounting.controller.js
- backend/src/controllers/serviceCompletion.controller.js
- backend/src/routes/serviceCompletion.routes.js
- backend/src/validators/serviceCompletion.validation.js
- backend/test/serviceCompletionCore.test.js
- backend/test/generalLedgerCore.test.js
- backend/test/glPostingPreview.test.js

Additional report/log artifacts are under reports/revenue-recognition-*.

## Preserved boundaries

Profitability v1 was not redesigned: verified supplier revenue minus actual direct costs is unchanged. Booking Expenses v1 remains unchanged, including duplicate protection, direct-cost categories, explicit FX, REVERSED/NEEDS_REVIEW exclusions, booking scope, and original creator/audit preservation. The 12 selected frozen source/test files match their pre-task SHA-256 hashes.

No historical backfill, production-data mutation, existing live journal adjustment, external booking/payment/refund action, OTA commission change or live Bókun/GYG/Viator mutation was performed. Test fixture journals/refunds exist only in disposable test databases that the runner removes.

No Settlement/Bank Reconciliation implementation was started. Settlement FX gain/loss posting and unsupported retained-fee evidence remain outside this module; insufficient evidence blocks recognition or requires controlled accounting review.

Release hold: activation boundary and target deployment prerequisites remain unapproved/unverified. Automatic posting stays OFF.

REVENUE RECOGNITION V1 STILL REQUIRES REVIEW

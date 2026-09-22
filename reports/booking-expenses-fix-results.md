# Booking Expenses — implementation and validation results

Date: 2026-09-21

The four HIGH findings named in the request are implemented. MEDIUM findings remain pending: their descriptions were not supplied in this conversation and no matching saved audit was found. The user was asked for the list/path; no unspecified MEDIUM fixes were inferred.

## Implemented behavior

| Finding | Change | Evidence |
| --- | --- | --- |
| Duplicate expense protection | Creates require a stable request key. The form retains it on failure and rotates it after success; a synchronous guard prevents simultaneous form submits. Canonical request hashes reject reuse with different contents. Duplicate-key races replay the existing expense, while duplicate expense references return a conflict. Updates cannot change the request key or expense reference. Replays return HTTP 200. | Concurrent eight-request regression, changed amount/booking/description conflicts, reference collision, immutable identity, API replay, frontend payload tests. |
| Direct-cost category enforcement | Booking Expense writes accept only DIRECT_SUPPLIER_COST, DIRECT_TRANSPORT_COST, DIRECT_GUIDE_COST, DIRECT_BOAT_COST and DIRECT_ACTIVITY_COST. Categories come from the API into a selector. The shared model retains historical operating categories and additionally supports these direct-cost categories; no records are reclassified. | Create/update rejection of operating and unknown categories; request-schema and model-schema checks. |
| Evidenced FX instead of automatic 1:1 | Expenses use the configured accounting base currency. Foreign amounts require an explicit positive rate, valid rate date and identifiable source/evidence reference. Missing evidence and generic placeholder sources are rejected. Currency changes cannot reuse evidence for the previous currency. Identity conversion is used only when transaction and accounting currencies match. Conversion uses decimal multiplication. | Missing/invalid FX cases; TZS 25,000 at USD 0.0004 = USD 10; base-currency bypass rejection; currency-change regression; frontend FX payload test. |
| REVERSED expenses excluded from Actual Direct Costs | The expense eligibility predicate excludes accountingStatus REVERSED for APPROVED and PAID records. This predicate is used consistently for actual cost totals, cost currency evidence, expense count and completion evidence. | Mixed active/reversed and reversed-only regressions, including a foreign-currency reversed expense and an assertion that source records remain unchanged. |

The initial seven regression tests all failed against the pre-change code for the expected duplicate/category/FX gaps, then passed after implementation.

## Scope and compatibility

- Profitability v1 was not redesigned. Its table was compared with the pre-task snapshot and is unchanged. Its calculation changes are limited to the requested expense-eligibility correction; revenue-basis and estimate logic remain unchanged.
- No production database connection, data migration, backfill, historical-expense update, journal operation, Bókun/OTA call, deployment or automatic-posting enablement was performed.
- Existing unrelated workspace changes were preserved. No other accounting module was started.
- New expense API submissions now require `idempotencyKey` and a valid `expenseDate`. Booking Expense writes must use a controlled direct-cost category. Clients must retain the key when retrying the same request.
- FX evidence is supplied by the authorized operator. The code requires provenance but does not independently contact or verify a bank or rate provider.
- Duplicate protection covers repeated submissions using the same key and expense-reference collisions. It does not infer that separately keyed expenses with similar amounts/descriptions are duplicates.
- Concurrency recovery uses the existing unique `idempotencyKey` and `expenseReference` indexes. No index migration was run and live database index state was not inspected.

## Validation

Tests ran with a deliberately unreachable local Mongo URI and mock provider settings, not production credentials or services.

| Check | Result | Log |
| --- | --- | --- |
| Backend: `npm test -- --test-concurrency=2` | Exit 0; 559 tests: 557 passed, 0 failed, 2 skipped | [Backend tests](booking-expenses-backend-tests.txt) |
| Backend: `npm run test:smoke` | Exit 0; Backend smoke OK | [Smoke](booking-expenses-backend-smoke.txt) |
| Backend: `npm run lint` | Exit 1; 4 pre-existing errors, 30 warnings | [Full lint](booking-expenses-backend-lint.txt) |
| ESLint on the five changed backend source files | Exit 0; 0 errors, 1 existing warning about `updateCostTemplate` | [Changed files lint](booking-expenses-changed-files-lint.txt) |
| Frontend: `npm test` | Exit 0; 144 passed, 0 failed | [Frontend tests](booking-expenses-frontend-tests.txt) |
| Frontend: `npm run build` | Exit 0; production build succeeded; large-chunk warning | [Build](booking-expenses-frontend-build.txt) |

The two skipped tests require an isolated Mongo environment: booking payment synchronization/concurrency and BI aggregation pipelines. No real Mongo-backed concurrency test or browser interaction test was run for this patch; duplicate races were exercised with a storage boundary that enforces unique identities. Frontend regressions cover executable payload behavior and form wiring, plus the production build.

Full lint errors, left unchanged because they are outside the authorized findings:

- `backend/src/config/db.js:15`: `no-process-exit`.
- `backend/src/scripts/bokunIdentityAudit.js:5`: missing `../../config/env` require.
- `backend/src/services/bokun/index.js:176`: `no-constant-condition`.
- `backend/src/services/webhooks/index.js:609`: `no-extra-boolean-cast`.

`git diff --quiet` confirmed these four files match Git and were not changed by this work.

## Files changed by this task

- `backend/src/accounting/bookingExpensePolicy.js` — new expense policy, request fingerprint and counting predicate.
- `backend/src/models/BusinessExpense.js` — direct-cost category support and request hash storage.
- `backend/src/services/bookingAccounting/index.js` — Booking Expense write protections, form configuration and reversed-expense eligibility.
- `backend/src/validators/bookingAccounting.validation.js` — request contract enforcement.
- `backend/src/controllers/bookingAccounting.controller.js` — replay response semantics.
- `frontend/src/pages/admin/bookingExpenseForm.js` — new form state and payload helpers.
- `frontend/src/pages/admin/AdminBookingAccountingPage.jsx` — expense form controls and submission protection only.
- `backend/test/bookingExpenseSafety.test.js` — 13 safety regressions.
- `backend/test/bookingAccountingCore.test.js` — 2 reversed-expense regressions.
- `backend/test/bookingAccountingRoutes.test.js` — 1 API validation/replay regression.
- `frontend/test/bookingExpenseSafety.test.js` — 3 frontend regressions.

[Incremental diff of the five previously modified source files](booking-expenses-incremental.diff) distinguishes this task's edits from the pre-existing workspace work. New files and test additions are listed above separately.

Work stops here. The MEDIUM audit list is needed before further Booking Expenses fixes; no other accounting module should begin from this result.

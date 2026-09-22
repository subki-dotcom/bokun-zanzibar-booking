# Booking Expenses V1 — remaining MEDIUM findings

Date: 2026-09-21

## Findings

| Finding | Classification | Current behavior |
| --- | --- | --- |
| NEEDS_REVIEW eligibility | FIXED | APPROVED/PAID is still required. Accounting status REVERSED or NEEDS_REVIEW, or completion status NEEDS_REVIEW, excludes an expense from Actual Direct Costs and actual-profit evidence. A financial status outside APPROVED/PAID was already excluded. Tests verify that resolving review into existing approved/validated states restores eligibility. |
| Booking-accounting scope | FIXED | The Actual Direct Costs source query explicitly requires ACCOUNTING_SCOPE.BOOKING, whose existing value is BOOKING_ACCOUNTING. The shared expense eligibility predicate independently requires the same exact scope. Business, missing and invalid scopes are rejected even with a matching booking reference, booking ID or booking source module. Other snapshot consumers retain their previous query behavior. |
| createdBy / audit trail | FIXED | Expense edits omit createdBy from the update instead of replacing it with the editor. createdAt was ALREADY_SAFE: it is absent from the update payload, and the model uses Mongoose timestamps. Existing booking_expense_updated audit events already attribute edits through actorId, requestId, entityId and before/after values; no second audit mechanism or schema was added. |

No new status workflow, posting requirement, migration or backfill was introduced. APPROVED/PAID remains the existing financial approval rule; this patch adds the explicit review vetoes and validated booking scope requested by the audit.

## Files changed

- `backend/src/accounting/bookingExpensePolicy.js`: scope and review eligibility checks.
- `backend/src/services/bookingAccounting/index.js`: scoped expense query argument for profitability reads; omission of creator identity from updates.
- `backend/test/bookingAccountingCore.test.js`: eligibility and scope regressions; explicit accounting scope in booking-expense fixtures.
- `backend/test/bookingExpenseSafety.test.js`: creator/timestamp preservation and existing audit attribution regressions; storage test double returns independent read snapshots.

This report and its supporting logs/diff are additional review artifacts. The frontend was neither edited nor rebuilt for this task.

## Regression coverage

Eight new tests:

- Four review-state cases: financial NEEDS_REVIEW, APPROVED with accounting NEEDS_REVIEW, PAID with accounting NEEDS_REVIEW, and APPROVED with completion NEEDS_REVIEW. Each verifies unchanged actual costs/profit while review is pending and restored eligibility after existing approval/review states are resolved in an isolated fixture.
- One query/behavior test: valid BOOKING_ACCOUNTING is counted, while business/missing/invalid scopes are excluded despite booking links. Source records remain unchanged.
- One independent eligibility matrix covering valid approved/paid expenses, non-booking scopes, draft/submitted/rejected/void/review statuses, and reversed/review accounting markers.
- User A creates and User B edits: original createdBy and createdAt remain intact, and the existing audit event attributes the edit to User B with accurate before/after values.
- An attempted payload replacement of creator/timestamp is ignored.

One existing completion-NEEDS_REVIEW regression was updated to assert exclusion rather than counted cost. Existing fixtures now explicitly declare their intended booking/business scope so earlier financial regression coverage remains meaningful.

Before the production-code edits, these tests reproduced eight failures; the financial-status NEEDS_REVIEW case was already safe. After the fixes, all focused tests passed.

## Validation results

| Command | Result | Evidence |
| --- | --- | --- |
| `node --test test/bookingExpenseSafety.test.js test/bookingAccountingCore.test.js test/bookingAccountingRoutes.test.js` | Exit 0; 48 passed, 0 failed, 0 skipped | [Focused tests](booking-expenses-medium-focused-tests.txt) |
| `npm test -- --test-concurrency=2` | Exit 0; 567 total, 565 passed, 0 failed, 2 skipped | [Full backend tests](booking-expenses-medium-backend-tests.txt) |
| ESLint on both changed source files | Exit 0; no errors, one pre-existing unused updateCostTemplate warning | [Lint](booking-expenses-medium-lint.txt) |
| `git diff --check` on the four changed code/test files | Exit 0 | No whitespace errors |

The two existing skips require isolated Mongo integration infrastructure: booking payment synchronization/concurrency and BI aggregation pipelines. Tests used an unreachable local Mongo URI, mock provider settings and in-memory storage boundaries; no live production database or external service was used for verification.

[Pre-fix failing regressions](booking-expenses-medium-before-tests.txt) and the [incremental diff against this task's starting files](booking-expenses-medium-incremental.diff) are retained for review.

## Preserved boundaries

- All four previous HIGH fixes remain intact and passed their focused regressions: duplicate/replay protection, direct-cost category validation, explicit FX evidence, and reversed-expense exclusion.
- Profitability v1 was not redesigned. A comparison of its implementation against the pre-task snapshot, normalizing line endings and the single scoped-query argument, confirmed the remainder of the implementation is unchanged. Formulas and Revenue Basis logic were not edited.
- Source-file hash comparison confirmed only the two Booking Expenses source files above changed. Frontend, GYG/Viator logic, Bókun/OTA integrations, payments, invoices, settlements, and posting configuration remain unchanged by this task.
- No production/historical data, Bókun/OTA data, journal or other accounting record was modified. All writes made by regression tests were to isolated in-memory fixtures. No historical backfill, deployment or server restart was performed.
- Automatic expense posting remains OFF: the unchanged local configuration has EXPENSE_AUTOMATIC_POSTING_ENABLED=false. The existing automatic-posting path requires this flag to be true as well as the matching mode. The mode alone does not enable automatic posting. Tests explicitly used PREVIEW_ONLY and a false enable flag.

All supplied HIGH and MEDIUM Booking Expenses findings are resolved. No other accounting module was started.

BOOKING EXPENSES V1 READY

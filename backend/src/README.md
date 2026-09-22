# Backend Source Layout

This folder keeps the Express API organized by responsibility.

- `config/`: Environment parsing, database connection, constants, and logger setup.
- `routes/`: API endpoint definitions. Routes choose middleware and call controllers.
- `controllers/`: Request and response handlers. Controllers read `req`, call services, and send JSON responses.
- `services/`: Business logic grouped by feature, for example `bookings/index.js`, `payments/dpo/index.js`, and `bokun/index.js`.
- `middleware/`: Shared Express middleware for auth, RBAC, validation, sanitization, rate limiting, request IDs, and errors.
- `utils/`: Reusable app helpers such as response formatting, quote tokens, and Mongo helpers.
- `validators/`: Zod schemas used by route middleware to validate request bodies, params, and query strings.
- `models/`: Mongoose schemas and models for local persistence.
- `jobs/`: Background workers and pollers that run outside a single HTTP request.
- `integrations/`: Provider-specific clients, mappers, and protocol helpers for Bokun, DPO, Pesapal, PayPal, and future external systems.
- `app.js`: Express app setup only. It wires middleware, health routes, and API routes.

`../server.js` is the process entry point. It loads environment variables, connects to MongoDB, starts Express, and starts background jobs.

## Authoritative financial reporting

`services/financialReporting/` is a read-only facts layer over Booking, Invoice, Payment, Refund, Settlement, BusinessExpense, AccountingPosting, and JournalEntry records. Business Accounting exposes the facts through:

- `GET /api/admin/business-accounting/bookings/:bookingReference/financial-facts`
- `GET /api/admin/business-accounting/authoritative-summary`

Summary amounts are grouped by currency and are never added across currencies. Direct customer collection, OTA pending payout, settlement receipt, refunds, fees, and direct costs remain separate concepts. Unknown sales channels remain unknown, and missing OTA settlement or commission evidence is returned as unavailable rather than estimated.

The existing Business Accounting foundation continues to report posting-based management totals and includes the read-only facts summary for reconciliation. Posting backfill is review-first: `scripts/plan-business-accounting-backfill.js` is dry-run only, while any explicit posting apply requires a human `approvalId` and the canonical idempotency key.

## Profitability v1 maintainer note

Profitability v1 is an analytical, read-only booking profitability view. Its formulas are:

- Actual booking profit = verified Revenue Basis - actual direct booking costs.
- Estimated booking profit = verified Revenue Basis - estimated direct costs.

Actual and estimated profitability remain separate. An explicit zero actual cost is valid evidence and produces a numeric actual profit; missing actual-cost evidence remains unavailable and must not be converted to zero.

Revenue Basis means the strongest verified supplier revenue amount attributable to Riser before direct operating costs. It is not automatically customer gross, customer payment, OTA payout, bank receipt, or an arbitrary booking total. For GetYourGuide, a verified seller invoice net is used: gross 22.00 USD less the 7.04 USD OTA commission gives Revenue Basis 14.96 USD, and that commission is not deducted again. For Viator, a verified supplier or seller invoice amount is used, such as 115.60 USD; no assumed 22%, 32%, or other commercial commission is applied. Viator gross without verified supplier amount remains unknown and requires review. Direct Riser bookings use the authoritative `pricingSnapshot.finalPayable` with known currency and retain the source `DIRECT_BOOKING_PRICING_SNAPSHOT_FINAL_PAYABLE`; arbitrary `booking.amount` is not sufficient.

Revenue evidence and profitability use the states `VERIFIED`, `UNKNOWN`, `NEEDS_REVIEW`, `NEEDS_REVIEW_FX`, and `NEEDS_POLICY`. Zero is distinct from `UNKNOWN`. Profit is never calculated across currencies without verified FX; a currency mismatch is `NEEDS_REVIEW_FX`, and no 1:1 conversion is assumed. Confirmed bookings use normal logic when evidence is valid. Cancelled, no-show, refunded, and partially refunded bookings use `NEEDS_POLICY` where approved policy does not determine the revenue and cost treatment.

Profitability is separate from settlement and reconciliation. Verified revenue evidence and available profitability may coexist with `UNRECONCILED` reconciliation, unknown payout, or unverified bank receipt. Unreconciled status does not block profitability. OTA commission accounting is deferred: verified OTA commission may be shown as informational evidence, but is not deducted again when Revenue Basis already represents supplier net. A Bókun Viator commission of 0% is not proof that Viator commercial commission is 0%. Riser internal agent commission remains separate.

Aggregate actual margin uses the same eligible economic basis as booking-level profitability: sum of eligible actual booking profits divided by the sum of verified Revenue Basis for those same eligible bookings, multiplied by 100. Rows with unknown revenue, review-required FX, unresolved policy, or unavailable actual costs are excluded rather than silently contaminating the aggregate.

Viewing or calculating Profitability v1 does not create or modify JournalEntry, AccountingPosting, Payment, Invoice, Settlement, Refund, Accounts Receivable, revenue postings, or OTA commission expense postings. Automatic accounting posting remains disabled.

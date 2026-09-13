# Bókun booking currency pipeline

## Root cause and traced booking

Booking `GYG7VKQ757HB` (Bókun `100267289`) was stored as EUR 70 and its local invoice `INV-20260909-0073` was EUR 70. The persisted Bókun response contains:

- `root.totalPrice = 70`
- `root.currency = EUR` — the reseller/seller account currency in this payload
- `invoice.totalAsMoney = { amount: 70, currency: USD }`
- `invoice.currency = USD`
- `customerPayments[0].amountAsMoney = { amount: 70, currency: USD }`
- activity customer-invoice money fields in USD
- activity seller currency in EUR

`confirmedBooking.mapper.js#extractMoney` selected the number from `root.totalPrice`, but separately selected `root.currency` before the customer-invoice currency. This created an invalid pair: the correct numeric amount with the reseller currency. The import copied EUR into `Booking.currency` and `pricingSnapshot.currency`; invoice creation then inherited it into `Invoice.accountingCurrency`; the frontend correctly formatted the incorrect stored ISO code as EUR.

## Canonical mapping

The mapper now selects an amount/currency pair from Bókun customer invoice Money objects first. The priority is customer invoice total, activity customer invoice total, root Money total, then an explicit numeric total plus the nearest invoice currency. `root.currency` is the final evidence fallback only. Currency must be a three-letter ISO code.

The resulting booking stores the same code in `transactionCurrency`, compatibility `currency`, and `pricingSnapshot.currency`, with `bokunCurrencySource` recording the evidence path. Missing currency makes the snapshot incomplete and requires review; USD is no longer invented.

The payment-status mapper follows the same customer invoice/payment currency precedence, so a customer-paid amount cannot be labelled with reseller EUR.

## Invoice and display behavior

New invoices inherit `Booking.transactionCurrency`. `Invoice.transactionCurrency` is separate from the legacy accounting currency field. Invoice views, printable invoices, Booking Management, the admin dashboard, agent booking tables and recent-booking tables prefer the record's transaction currency. `Intl.NumberFormat` receives the ISO code from the record; no currency symbol replacement was introduced.

Webhook/poll updates use the same booking mapper for rows whose Bókun currency lineage is already established. Manual resync uses the confirmed-booking import mapper. Historical rows without established lineage are marked for review and retain their stored money/currency during normal polling, preventing an unreviewed mass rewrite.

## Historical audit

The read-only audit scanned 82 Bókun-linked bookings:

- 65 matched Bókun and invoice currency.
- 17 had `BOOKING_CURRENCY_MISMATCH`.
- The same 17 had `INVOICE_CURRENCY_MISMATCH`.
- No missing Bókun currencies were found.
- All 17 mismatches were GetYourGuide rows stored/invoiced as EUR while Bókun customer invoice evidence is USD.
- Stored totals: USD 4,945.96 across 65 rows; EUR 1,616.90 across 17 rows.
- Bókun transaction totals: USD 6,221.86 across all 82 rows.

Artifacts:

- `reports/bokun-currency-audit.json`
- `reports/bokun-currency-audit-after-restart.json`
- `reports/bokun-currency-repair-dry-run.json`

After explicit approval, the guarded repair applied all 17 reviewed rows. It changed only booking/pricing/invoice currency fields and Bókun lineage metadata; all numeric amounts remained unchanged. The affected set contained zero Payment, Refund and JournalEntry records. Seventeen immutable repair audit entries were created.

Post-repair audit result: 82 matches and zero currency mismatches. The applied evidence is stored in `reports/bokun-currency-repair-applied.json`, and the post-repair audit is `reports/bokun-currency-audit-after-repair.json`.

## Verification

- Backend: 407 tests passed, including USD 70, EUR 70, TZS, missing currency, channel independence, manual resync, webhook mapping, invoice inheritance and isolated Mongo checks.
- Frontend: 105 tests passed, including ISO transaction-currency precedence and USD/EUR/TZS formatting.
- Frontend production build passed with the existing large-chunk warning.
- Local backend restarted successfully; health returned HTTP 200.
- A second read-only audit after restart still reported 17 mismatches, confirming normal polling did not modify historical currency records.
- Backend lint remains unavailable because the installed backend dependencies do not contain an executable ESLint binary.

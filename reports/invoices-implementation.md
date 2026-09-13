# Invoices redesign — 9 September 2026

The existing `/admin/booking-accounting/invoices` URL now renders the dedicated invoice register within the existing AdminLayout. Sidebar, header, route authentication and backend accounting are preserved. No backend files were changed for this redesign. Earlier BI, Report Center and pending Bókun sync edits remain separate in the working tree.

## Files changed

- `frontend/src/routes/AppRoutes.jsx`: existing invoice route points to its dedicated page.
- `frontend/src/pages/admin/AdminInvoicesPage.jsx`: new invoice page implementation.
- `frontend/src/pages/admin/invoices.css`: scoped register, drawer, print and responsive styling.
- `frontend/src/components/invoice/InvoiceRegisterComponents.jsx`: summary cards, table, mobile cards, actions, pagination, drawer, skeleton and error components.
- `frontend/src/components/invoice/invoiceView.js`: decimal normalization, currency-safe page summaries, display helpers, inclusive date filters and escaped CSV export.
- `frontend/test/invoices.test.js`: five data/format/export tests.
- `frontend/test/invoiceRendering.test.js`: four rendering tests.

## Existing APIs and components reused

- `fetchBookingAccountingInvoices`: existing `GET /api/admin/booking-accounting/invoices` with page, limit, search, status, fromDate and toDate.
- `fetchInvoiceByBookingReference`: existing `GET /api/invoices/booking/:bookingReference` for one selected invoice.
- Existing `AdminLayout`, API client, shared date/money formatting and independent resource hook.
- React Bootstrap Offcanvas supplies the accessible modal drawer and focus handling; Dropdown supplies row menus. Existing react-icons library supplies icons.

The former shared Booking Accounting page and its other modes remain intact. Opening Invoices now loads only the invoice list; it no longer loads six unrelated accounting datasets.

## Filtering and pagination

Search is debounced 300ms and uses the server's invoice number, booking reference, customer name/email and tour name search. Status options match the Invoice model's payment statuses. Quick tabs use those same filters. Date filtering uses inclusive issue-date bounds in Africa/Dar_es_Salaam, with invalid/reversed dates rejected. Clearing filters and changing a filter resets the page.

Pagination is server-side: 25 rows by default, with 50 and 100 available. The footer uses the server's total count; no complete-register fetch or browser-only pagination. Tab counts are shown only for the currently queried status because cross-status counts are not supplied by the API.

## Financial integrity

Rows and details use backend-supplied total, paid, refunded, net paid and balance. Decimal128 canonical fields take precedence over legacy numeric fields, including zero balances. No new balance formula or currency conversion is introduced.

The existing invoice endpoint has no whole-register aggregate response. Accordingly, four summary cards show **current-page** invoiced, paid, outstanding and refunded totals with an explicit scope note. Currencies remain separate (the local test page included EUR and USD). This avoids presenting a sampled subtotal as the business total. Missing values are unavailable, not invented zeroes.

A past-due indicator appears only with a stored due date and a positive authoritative balance. It does not invent an `overdue` payment status or unsupported API filter.

## Invoice details and actions

Rows and View Invoice buttons open a right-side 500px drawer; mobile uses the full viewport width. The drawer uses real customer, booking, line-item, invoice-total, payment/refund-summary, payment-term and recorded-date fields. Missing breakdowns have honest messages. Each monetary value respects the invoice currency.

Connected actions:
- View Invoice.
- View Booking through the existing booking register with the reference in its search query.
- Print / Save PDF through the browser print workflow; print CSS includes the actual invoice overview and payment summary regardless of the selected drawer tab.
- Export current page as CSV, retaining currency and authoritative balances and escaping spreadsheet formula prefixes.

## Responsive behavior and accessibility

Four desktop KPI columns; two on tablet/mobile. Filters wrap, date inputs stack on narrow screens. Desktop/tablet tables scroll within the register where necessary; under 768px invoices become readable cards. Pagination simplifies on mobile. Drawer is full-width on mobile. Financial text uses tabular numerals and monetary columns align right. Focus outlines, labels, accessible status text, 44px primary controls, reduced-motion skeletons and retry alerts are included. Existing shell/sidebar behavior is unchanged.

## Intentionally omitted unsupported capabilities

- Manual Create Invoice, Send Invoice, Duplicate, Cancel Invoice and Record Payment mutations: no suitable invoice endpoints in the current module.
- Direct PDF generation: existing frontend offers browser printing; action accurately says Print / Save PDF.
- Whole-register monetary KPI totals and per-status counts: no invoice aggregation endpoint, and backend changes were prohibited.
- Channel filtering/badges: invoice listing does not return channel or implement channel filtering.
- Individual payment/refund transactions and full activity audit: invoice details return stored totals and dates, not those histories. The drawer explains this rather than inventing records.
- No fake sparkline history, screenshots' figures, customer records or invoices.

## Verification

- Frontend suite: 100 passed, 0 failed.
- Existing Booking Accounting core/routes tests: 16 passed, 0 failed.
- Production build passed; existing bundle-size warning remains.
- Lint attempted: installed backend dependencies lack the ESLint executable. Frontend has no lint script; neither package has a typecheck script.
- Local authenticated API smoke check: 118 real invoices, 25 on the first page, EUR/USD preserved; second page returned 25. Exact invoice search returned one match, status filtering matched requested status, and date filtering returned 73. Selected detail's invoice identity, canonical total and canonical balance matched its list row. Frontend route returned HTTP 200.
- No synthetic records were created for these checks.
- Browser runtime reported no connected browser. Visual viewport verification, interactive drawer/print testing and browser-console checks remain unverified. CSS breakpoints and server-rendered states were inspected/tested, which does not replace visual browser testing.

Changes are local and have not been pushed or deployed to Vercel/Render.

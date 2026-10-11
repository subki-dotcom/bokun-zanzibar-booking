# Zanzibar Bokun Integration Booking System

Production-oriented full-stack booking platform for Zanzibar tours and activities where **Bokun remains the only source of truth** for products, options, availability, capacity, pricing, and booking lifecycle.

## Core Principle

- Bokun is master for inventory and bookings.
- Local MongoDB stores snapshots and business layers only: analytics, invoices, offers, commissions, reports, audit logs, and portal UX acceleration.
- Every final booking is revalidated live and created in Bokun first.

## Source Of Truth

- Bokun: products, options, availability, live pricing, and pickup places.
- Customer: name, email, phone, and special request.
- Backend: validation, data merging, security, payments, and booking creation.

## Tech Stack

- Frontend: React + React Bootstrap + Vite
- Backend: Node.js + Express
- DB: MongoDB + Mongoose
- Auth: JWT + RBAC
- HTTP: Axios + retry/timeout handling

## Project Structure

```text
backend/
  server.js
  src/
    app.js
    config/
    controllers/
    jobs/
    integrations/
      bokun/
      dpo/
      pesapal/
    middleware/
    models/
    routes/
      payments/
    services/
      agents/ auth/ bookings/ bokun/ commissions/ customers/
      invoices/ offers/ payments/ reports/ tours/ users/ webhooks/
    utils/
    validators/
  scripts/seedAdmin.js

frontend/          Customer website and agent portal (port 5173)
  src/
    api/
    app/
    components/
      common booking tours checkout dashboard agents invoice
    context/
    hooks/
    layouts/
    pages/
      public agent
    routes/          AppRoutes mounts the Back Office route table at /admin as a fallback
    utils/

backoffice/        Back Office (admin and staff), a separate Vite app (port 5174)
  src/
    api/adminApi.js
    components/admin/ components/invoice/
    config/adminNavigation.js
    layouts/admin/
    pages/admin/
    routes/AdminRoutes.jsx      the admin route table, used by both apps
  test/

shared/            Code used by both apps (API client, auth, common components, utilities, global styles)
  src/
  vite.shared.js   package de-duplication used by both Vite configs
```

The website keeps `/admin` working as a fallback: it mounts the same route table from `backoffice/`. Admins sign in
separately on each app because the session is stored per origin.

## Environment Variables

Use `.env.example` (root) or service-level examples:

- `backend/.env.example`
- `frontend/.env.example`

Required backend vars:
- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `BOKUN_BASE_URL`
- `BOKUN_ACCESS_KEY`
- `BOKUN_SECRET_KEY`
- `BOKUN_API_KEY`
- `BOKUN_WEBHOOK_SECRET` (optional)
- `BOKUN_BOOKING_SYNC_ENABLED`
- `BOKUN_BOOKING_SYNC_INTERVAL_SECONDS`
- `BOKUN_BOOKING_SYNC_BATCH_SIZE`
- `BOOKING_FINALIZATION_RETRY_ENABLED`
- `BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS`
- `BOOKING_FINALIZATION_RETRY_BATCH_SIZE`
- `BOOKING_FINALIZATION_MAX_RETRIES`
- `BOOKING_LEGACY_PRICING_RECOVERY_ENABLED`
- `BOOKING_LEGACY_PRICING_RECOVERY_BATCH_SIZE`
- `PESAPAL_BASE_URL`
- `PESAPAL_AUTH_PATH`
- `PESAPAL_SUBMIT_ORDER_PATH`
- `PESAPAL_STATUS_PATH`
- `PESAPAL_REGISTER_IPN_PATH`
- `PESAPAL_CONSUMER_KEY`
- `PESAPAL_CONSUMER_SECRET`
- `PESAPAL_IPN_URL` (public backend URL for automatic IPN registration)
- `PESAPAL_IPN_ID`
- `PESAPAL_SUCCESS_URL`
- `PESAPAL_CANCEL_URL`
- `PESAPAL_ALLOW_LOCAL_REDIRECTS` (default: `false`)
- `DPO_BASE_URL`
- `DPO_COMPANY_TOKEN`
- `DPO_SERVICE_TYPE`
- `DPO_SUCCESS_URL`
- `DPO_CANCEL_URL`
- `DPO_CALLBACK_URL` (optional)
- `DPO_ALLOW_LOCAL_REDIRECTS` (default: `false`)
- `PAYPAL_BASE_URL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_SUCCESS_URL`
- `PAYPAL_CANCEL_URL`
- `PAYPAL_ALLOW_LOCAL_REDIRECTS` (default: `false`)
- `DEFAULT_CURRENCY`
- `FRONTEND_URL`
- `BACKOFFICE_URL` (optional, comma separated Back Office origins for CORS; local: `http://localhost:5174`. In production only `https` origins are accepted.)

Required frontend vars:
- `VITE_API_BASE_URL` (example: `https://bokun-zanzibar-booking.onrender.com`)

Back Office vars (`backoffice/.env.example`):
- `VITE_API_BASE_URL` (local: `http://127.0.0.1:5000/api`)
- `VITE_WEBSITE_URL` (local: `http://localhost:5173`; used for password recovery and links to customer pages)

Development fallback:
- `BOKUN_MOCK_MODE=true` enables mock Bokun layer for frontend and local development.
- `PESAPAL_MOCK_MODE=true` lets checkout run locally without hitting live Pesapal.
- `DPO_MOCK_MODE=true` lets checkout run locally without hitting live DPO.
- `PAYPAL_MOCK_MODE=true` lets checkout run locally without hitting live PayPal.
- In live Pesapal mode, callback URLs should be public unless `PESAPAL_ALLOW_LOCAL_REDIRECTS=true`.
- `PESAPAL_SUCCESS_URL` and `PESAPAL_CANCEL_URL` must use one of the configured `FRONTEND_URL` origins, and `PESAPAL_IPN_URL` must point to the backend that owns the same database/payment records.
- Pesapal success, failed, cancelled, and pending attempts are verified by the backend and displayed on the branded frontend result page; never rely on the browser redirect alone as proof of payment.
- For local live Pesapal tests, expose both frontend and backend through a public tunnel and set `FRONTEND_URL`, `PESAPAL_SUCCESS_URL`, `PESAPAL_CANCEL_URL`, `PESAPAL_IPN_URL`, and frontend `VITE_API_BASE_URL` to that same test environment.
- In live DPO/PayPal mode, success and cancel URLs should be public unless the matching `*_ALLOW_LOCAL_REDIRECTS=true` flag is intentionally enabled for local tests.

## Setup

1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../backoffice && npm install
```

2. Configure env

```bash
# copy examples
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp backoffice/.env.example backoffice/.env
```

For local development set `BACKOFFICE_URL=http://localhost:5174` in `backend/.env`, and point both apps at the local
backend (`VITE_API_BASE_URL=http://127.0.0.1:5000/api`).

3. Seed first admin (super_admin on first run)

```bash
cd backend
npm run seed:admin
```

4. Start backend

```bash
cd backend
npm run dev
```

5. Start the customer website (http://localhost:5173)

```bash
cd frontend
npm run dev
```

6. Start the Back Office (http://localhost:5174)

```bash
cd backoffice
npm run dev
```

Run the three in separate terminals. On Windows, from the repository root:

```powershell
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd backend; npm run dev'
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd frontend; npm run dev'
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd backoffice; npm run dev'
```

7. Tests and builds

```bash
cd frontend && npm test && npx vite build     # website (npm run build also prerenders SEO pages from a public API)
cd backoffice && npm test && npm run build    # Back Office
cd backend && npm test && npm run lint
```

## Transfer System

An independent transfer booking and operations system (`backend/src/transfers/`). It does not use Bókun, the
Agent System or the Business Back Office, and it does not post to the existing accounting.

- Own database `riser_transfers` on the same MongoDB server, reached with its own user that has `readWrite` on that
  database only. On connect the backend checks the user's privileges and refuses any access beyond `riser_transfers`
  (in production it also refuses unauthenticated connections or the Business Platform user).
- Own admin users (`transfer_admin_users`), own token secret (`TRANSFER_JWT_SECRET`), roles `transfer_admin`,
  `transfer_manager`, `dispatcher`, `transfer_accountant`, account lockout after 5 failed sign-ins, and an immutable
  audit log (`transfer_audit_logs`).
- Pricing: zones → locations, zone-to-zone routes (one-way or bidirectional) and passenger tiers priced per vehicle in
  USD. Prices are always computed on the server. Age bands: adults 12+, children 4–11, infants 0–3. Adults and children count toward the tier; infants always count
  toward capacity, and whether they count toward the tier is a setting. Routes or passenger counts without a rate
  become "Request a Quote".

Local setup (uses the local MongoDB; never production):

```bash
cd backend
# 1. Database user with readWrite on riser_transfers only (admin connection used for this run only)
MONGO_ADMIN_URI=mongodb://127.0.0.1:27017/admin TRANSFERS_DB_PASSWORD=<24+ random chars> npm run transfers:create-db-user
# 2. Set TRANSFERS_MONGO_URI, TRANSFERS_DB_NAME and TRANSFER_JWT_SECRET in backend/.env (see .env.example)
# 3. First transfer_admin (no default password)
TRANSFER_ADMIN_NAME="Your Name" TRANSFER_ADMIN_EMAIL=you@example.com TRANSFER_ADMIN_PASSWORD=<12+ chars, Aa1> npm run transfers:create-admin
# 4. Optional, local only: Zone A → Zone B, 1–5 passengers = USD 45
npm run transfers:seed-demo
```

Customer booking (website `/transfers`, public API `/api/transfers`):

- `GET /locations` (active locations only), `POST /quote` (server price or "Request a Quote")
- `POST /bookings` with an `Idempotency-Key` header. The server prices the booking again and refuses it with
  `409 TRANSFER_PRICE_CHANGED` if the price differs from the `expectedTotal` the customer saw. A priced booking is
  stored as `AWAITING_PAYMENT`; one without a rate is `QUOTE_REQUESTED`. Nothing is marked confirmed until payment
  is verified (T5). Retries with the same key return the same booking.
- `GET /bookings/:reference` with an `X-Transfer-Access-Token` header. References are random (`TRF-XXXXXXXX`) and
  never open a booking on their own. The token is an HMAC of a per-booking nonce, so it is not stored. The website
  keeps it in the link's `#fragment`. Responses mask email and phone and contain no internal ids.
- Rate limits per IP: 10 bookings per 15 minutes, 60 quotes per minute, 60 lookups per 15 minutes.

Transfer Admin API (`/api/transfer-admin`, Transfer Admin token required except for login):

- `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout-everywhere`
- `GET|POST /zones`, `PATCH /zones/:zoneId`; same for `/locations`, `/routes`, `/rates`
- `GET|PATCH /settings/pricing` (infant pricing policy; booking horizon `maxAdvanceDays`, 730 days by default)
- `POST /pricing/preview` (server-side price for a one-way or round trip)
- `GET|POST /users`, `PATCH /users/:userId`, `POST /users/:userId/reset-password`
- `GET /audit-logs`

## GitHub Hardening + Deployment

### 1) Branch protection (recommended on `main`)

Enable in GitHub:
- `Settings` -> `Branches` -> `Add branch protection rule`
- Branch pattern: `main`
- Require pull request before merging
- Require approvals: at least 1
- Require status checks before merging
  - Required check: `build-and-smoke`
- Block force pushes
- Block deletions

### 2) Repository secrets for CI/CD

Add these secrets in:
- `Settings` -> `Secrets and variables` -> `Actions`

Required for deployment webhook automation:
- `BACKEND_DEPLOY_WEBHOOK_URL`
- `FRONTEND_DEPLOY_WEBHOOK_URL`

Optional (if your deploy endpoint requires auth):
- `BACKEND_DEPLOY_WEBHOOK_TOKEN`
- `FRONTEND_DEPLOY_WEBHOOK_TOKEN`

### 3) Deployment workflow

This repo includes:
- `.github/workflows/deploy-production.yml`

Behavior:
- Auto-runs after `CI` succeeds on `main`
- Supports manual run via `workflow_dispatch`
- Triggers backend/frontend deploy webhooks
- Skips missing targets safely with warnings

## API Route Summary

### Platform Health
- `GET /`
- `GET /api/health`

### Auth
- `POST /api/auth/login`
- `POST /api/auth/register-admin`
- `GET /api/auth/me`

### Tours + Sync
- `GET /api/tours`
- `GET /api/tours/:slug`
- `GET /api/tours/:id/options`
- `POST /api/tours/sync` (admin/staff)

### Bokun Adapter Layer
- `GET /api/bokun/products/:productId/booking-config`
- `POST /api/bokun/products/:productId/live-quote`
- `POST /api/bokun/availability`
- `POST /api/bokun/booking-questions` (legacy compatibility; returns no Bokun questions)
- `POST /api/bokun/bookings` (admin only)
- `GET /api/bokun/bookings/:reference` (admin only)
- `POST /api/bokun/bookings/:bookingId/cancel` (admin only)
- `POST /api/bokun/bookings/:bookingId/edit` (admin only)

### Booking Engine
- `POST /api/bookings/quote`
- `POST /api/bookings/create`
- `GET /api/bookings/:reference`
- `POST /api/bookings/:id/cancel`
- `POST /api/bookings/:id/edit-request`
- `GET /api/bookings/recent`
- `GET /api/bookings/stats`
- `GET /api/bookings/finalization/pending` (admin/staff)
- `POST /api/bookings/:id/finalization/retry` (admin/staff)
- `POST /api/bookings/finalization/reconcile` (admin/staff)

### Admin + Agent + Ops
- `GET /api/reports/dashboard-summary`
- `GET /api/reports/daily-bookings`
- `GET /api/reports/monthly-sales`
- `GET /api/reports/performance`
- `GET /api/commissions/summary`
- `GET /api/agents/me/dashboard`
- `GET /api/agents/me/statements/:month`

### Invoice + Payment + Offers
- `GET /api/invoices/booking/:bookingReference`
- `GET /api/invoices/:invoiceNumber`
- `GET /api/payments`
- `GET /api/payments/reconciliation`
- `POST /api/payments/reconciliation/:bookingReference/recheck-pesapal`
- `POST /api/payments/reconciliation/:bookingReference/sync-invoice`
- `POST /api/payments/reconciliation/:bookingReference/retry-bokun`
- `POST /api/payments/reconciliation/:bookingReference/mark-reviewed`
- `POST /api/payments/pesapal/create`
- `GET /api/payments/pesapal/success?OrderTrackingId=...`
- `GET /api/payments/pesapal/cancel?OrderTrackingId=...`
- `POST /api/payments/dpo/create`
- `GET /api/payments/dpo/success?TransactionToken=...`
- `GET /api/payments/dpo/cancel?TransactionToken=...`
- `POST /api/payments/paypal/create`
- `GET /api/payments/paypal/success?token=...`
- `GET /api/payments/paypal/cancel?token=...`
- `POST /api/webhooks/bokun`
- `POST /api/webhooks/bokun/poll`
- `GET /api/offers`
- `POST /api/offers`

## Example Booking Flow (Option-Level)

1. Frontend loads local product snapshot (`/api/tours/:slug`).
2. User selects an option and date.
3. User selects a Bokun price catalog (when multiple catalogs exist for the product).
4. Frontend requests live availability (`/api/bokun/availability`).
5. Frontend requests quote (`/api/bookings/quote`) and receives quote token.
6. Customer enters name, email, phone, and special request in the local customer step.
7. Customer chooses a payment method: Pesapal, DPO, or PayPal.
8. Customer clicks **Confirm & Pay** and backend creates a local pending booking + gateway order (`/api/payments/:provider/create`).
9. User is redirected to the selected secure payment page.
10. Frontend callback/IPN verifies payment and immediately updates the local payment record, booking payment status, invoice amount paid/status, and invoice snapshot.
11. Backend then finalizes the booking in Bokun as a separate supplier confirmation step.
12. If the gateway is paid but Bokun is slow or temporarily fails, the customer still sees the invoice as paid while supplier confirmation remains pending.
13. If Bokun is temporarily unreachable during finalization, backend returns `paid_pending_finalization` (payment remains paid, booking stays pending) and retries can be triggered safely by re-calling the success endpoint.

## Bokun Booking Sync (Webhook + Polling Fallback)

- Webhook: `POST /api/webhooks/bokun`
- Optional webhook secret header: `x-bokun-webhook-secret`
- Polling fallback:
  - `BOKUN_BOOKING_SYNC_ENABLED=true`
  - `BOKUN_BOOKING_SYNC_INTERVAL_SECONDS=300` (example)
  - `BOKUN_BOOKING_SYNC_BATCH_SIZE=20` (example)
- Manual fallback trigger (admin/staff): `POST /api/webhooks/bokun/poll`

The sync updates local booking snapshots (status/date/time/confirmation) from Bokun changes while keeping Bokun as source of truth.

## Booking Finalization Reliability Pack

- Idempotent lock per booking finalization attempt (`pendingCheckout.finalization`).
- Safe retries with `nextRetryAt` + capped `BOOKING_FINALIZATION_MAX_RETRIES`.
- Admin recovery APIs for listing stuck paid bookings and retrying safely.
- Payment reconciliation APIs compare gateway status, local payment status, invoice status, expected/paid amounts, and Bokun supplier status.
- Bokun retry is allowed only when the verified payment record and invoice are paid.
- Optional background reconciler:
  - `BOOKING_FINALIZATION_RETRY_ENABLED=true`
  - `BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS=30`
  - `BOOKING_FINALIZATION_RETRY_BATCH_SIZE=20`
  - `BOOKING_LEGACY_PRICING_RECOVERY_ENABLED=true` safely rechecks only paid, exhausted legacy `pricingCategoryId` failures once.

## Bokun Integration Files

- `backend/src/integrations/bokun/bokun.client.js`
- `backend/src/integrations/bokun/bokun.mapper.js`
- `backend/src/services/bokun/index.js`
- `backend/src/controllers/bokun.controller.js`
- `backend/src/routes/bokun.routes.js`

## Security + Reliability Implemented

- Helmet
- CORS (frontend origin)
- Rate limiting
- Mongo payload sanitization + input trimming
- Zod request validation
- JWT auth + RBAC (`super_admin`, `admin`, `staff`, `agent`)
- Request IDs in responses/logging
- Normalized JSON API response format
- Axios timeout + safe retry for Bokun calls
- Quote token signature + expiry to prevent stale booking submissions
- Audit logging for booking create/cancel/edit workflows

## MongoDB Models

- `User`
- `Agent`
- `Customer`
- `ProductSnapshot`
- `Booking`
- `Invoice`
- `Payment`
- `Offer`
- `CommissionRecord`
- `SyncLog`
- `AuditLog`

## Frontend Pages Included

Public:
- Home
- Tours listing
- Single tour page
- 7-step booking flow
- Booking confirmation page
- My booking page
- Invoice details page

Admin (Back Office app in `backoffice/`, also reachable at the website's /admin fallback):
- Dashboard starter (KPI cards + recent bookings + top metrics)
- Bookings list
- Sync logs page

Agent:
- Agent dashboard starter
- Agent bookings page
- Monthly commission statement panel

## Sample Postman Payloads

### Quote
`POST /api/bookings/quote`

```json
{
  "productId": "bk_prod_znz_dolphin",
  "optionId": "bk_opt_znz_dolphin_shared",
  "priceCatalogId": "104666",
  "travelDate": "2026-04-02",
  "startTime": "09:00",
  "pax": { "adults": 2, "children": 1, "infants": 0 },
  "extras": [{ "code": "hotel_transfer", "label": "Hotel Transfer", "quantity": 1, "amount": 15 }],
  "promoCode": "APRIL10"
}
```

### Create Booking
`POST /api/bookings/create`

```json
{
  "quoteToken": "<from-quote-response>",
  "productId": "bk_prod_znz_dolphin",
  "optionId": "bk_opt_znz_dolphin_shared",
  "priceCatalogId": "104666",
  "travelDate": "2026-04-02",
  "startTime": "09:00",
  "pax": { "adults": 2, "children": 1, "infants": 0 },
  "extras": [{ "code": "hotel_transfer", "label": "Hotel Transfer", "quantity": 1, "amount": 15 }],
  "customer": {
    "firstName": "Asha",
    "lastName": "M",
    "email": "asha@example.com",
    "phone": "+255700000000",
    "country": "TZ",
    "hotelName": "Nungwi Beach Lodge"
  },
  "bookingQuestions": [
    { "questionId": "pickup_location", "label": "Pickup hotel/location", "scope": "booking", "answer": "Nungwi Beach Lodge" }
  ]
}
```

### Initialize Payment

Checkout supports these provider endpoints:
- `POST /api/payments/pesapal/create`
- `POST /api/payments/dpo/create`
- `POST /api/payments/paypal/create`

Use the same booking payload shape and set `paymentMethod` to `pesapal`, `dpo`, or `paypal`.

```json
{
  "quoteToken": "<from-quote-response>",
  "productId": "bk_prod_znz_dolphin",
  "optionId": "bk_opt_znz_dolphin_shared",
  "priceCatalogId": "104666",
  "travelDate": "2026-04-02",
  "startTime": "09:00",
  "pax": { "adults": 2, "children": 1, "infants": 0 },
  "extras": [{ "code": "hotel_transfer", "label": "Hotel Transfer", "quantity": 1, "amount": 15 }],
  "customer": {
    "firstName": "Asha",
    "lastName": "M",
    "email": "asha@example.com",
    "phone": "+255700000000",
    "country": "TZ",
    "hotelName": "Nungwi Beach Lodge"
  },
  "bookingQuestions": [
    { "questionId": "pickup_location", "label": "Pickup hotel/location", "scope": "booking", "answer": "Nungwi Beach Lodge" }
  ],
  "paymentMethod": "paypal",
  "amount": 140,
  "currency": "USD"
}
```

Success/cancel callbacks:
- Pesapal: `/api/payments/pesapal/success`, `/api/payments/pesapal/cancel`
- DPO: `/api/payments/dpo/success`, `/api/payments/dpo/cancel`
- PayPal: `/api/payments/paypal/success`, `/api/payments/paypal/cancel`

## Pesapal Live Checklist

Before using live Pesapal mode (`PESAPAL_MOCK_MODE=false`):

1. Set active credentials:
   - `PESAPAL_CONSUMER_KEY`
   - `PESAPAL_CONSUMER_SECRET`
   - `PESAPAL_IPN_URL` (recommended) or `PESAPAL_IPN_ID`
2. Set callback URLs:
   - `PESAPAL_SUCCESS_URL=https://<public-domain>/payment-success`
   - `PESAPAL_CANCEL_URL=https://<public-domain>/payment-failure`
3. Use a stable backend domain for production IPN, for example:
   - `PESAPAL_IPN_URL=https://api.risertoursandsafaris.co.tz/api/payments/pesapal/ipn`
4. Keep callback URLs public unless `PESAPAL_ALLOW_LOCAL_REDIRECTS=true` is intentionally enabled for local tests.

Common API results:
- `HTTP 401/403`: auth or edge policy issue (confirm keys/IP/domain with Pesapal support).
- `PESAPAL_IPN_SETUP_MISSING`: set `PESAPAL_IPN_URL` or `PESAPAL_IPN_ID` before live checkout.

## DPO Live Checklist

Before using live DPO mode (`DPO_MOCK_MODE=false`):

1. Set active credentials:
   - `DPO_COMPANY_TOKEN`
   - `DPO_SERVICE_TYPE`
2. Set callback URLs:
   - `DPO_SUCCESS_URL=https://<public-domain>/payment-success`
   - `DPO_CANCEL_URL=https://<public-domain>/payment-failure`
   - `DPO_CALLBACK_URL=https://<public-backend-domain>/api/payments/dpo/callback` if DPO enables server-to-server callbacks for your account.
3. Keep callback URLs public unless `DPO_ALLOW_LOCAL_REDIRECTS=true` is intentionally enabled for local tests.

## PayPal Live Checklist

Before using live PayPal mode (`PAYPAL_MOCK_MODE=false`):

1. Set active credentials:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_WEBHOOK_ID`
2. Choose the correct API base URL:
   - Sandbox: `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
   - Live: `PAYPAL_BASE_URL=https://api-m.paypal.com`
3. Set callback URLs:
   - `PAYPAL_SUCCESS_URL=https://<public-domain>/payment-success`
   - `PAYPAL_CANCEL_URL=https://<public-domain>/payment-failure`
4. Keep callback URLs public unless `PAYPAL_ALLOW_LOCAL_REDIRECTS=true` is intentionally enabled for local tests.
5. Register `https://<public-backend-domain>/api/payments/paypal/webhook` in the PayPal Developer Dashboard and subscribe to `CHECKOUT.ORDER.APPROVED`.

## Server-to-server Payment Callbacks

- PayPal webhook: `POST /api/payments/paypal/webhook`. The server verifies PayPal's transmission signature using `PAYPAL_WEBHOOK_ID` before it captures an approved order.
- DPO callback: `GET|POST /api/payments/dpo/callback`. Set `DPO_CALLBACK_URL` to this public endpoint. The callback is only accepted after the backend re-verifies its transaction token with DPO.

## Notes for Production Hardening

- Replace Bokun mock routes with your final Bokun endpoint paths/signing format.
- Add centralized structured logger sink (e.g. ELK, Datadog, CloudWatch).
- Add webhook signature validation once Bokun webhook signature contract is finalized.
- Add additional payment provider adapters (Stripe/manual/cash) behind `payments.service` abstraction.
- Add charts library (Recharts/Chart.js) to replace dashboard placeholders.

## Booking Change, Cancellation and Refund Workflow

Customers submit requests from **My Booking** after confirming the email used for the booking. They cannot change a confirmed supplier booking directly.

Customer API:

- `POST /api/bookings/:bookingId/requests`
- `GET /api/bookings/:bookingId/requests?customerEmail=<email>`
- `GET /api/bookings/:bookingId/cancellation-estimate?customerEmail=<email>`
- `GET /api/booking-requests/:requestId?customerEmail=<email>`
- `POST /api/booking-requests/:requestId/customer-response`
- `POST /api/booking-requests/:requestId/cancel`

Admin API (JWT role: `super_admin`, `admin`, or `staff`; refund completion requires `super_admin` or `admin`):

- `GET /api/admin/booking-requests`
- `GET /api/admin/booking-requests/:requestId`
- `POST /api/admin/booking-requests/:requestId/approve`
- `POST /api/admin/booking-requests/:requestId/reject`
- `POST /api/admin/booking-requests/:requestId/request-information`
- `POST /api/admin/booking-requests/:requestId/recalculate-price`
- `POST /api/admin/booking-requests/:requestId/retry-bokun-sync`
- `POST /api/admin/booking-requests/:requestId/send-email`
- `POST /api/admin/refunds/:refundId/status`

MongoDB creates the required indexes automatically when the backend starts. Before production, take a backup and confirm that indexes exist for `BookingRequest`, `Refund`, `PaymentAdjustment`, `Payment`, and `Invoice`.

Required production configuration:

- Set `EMAIL_ENABLED=true`, `RESEND_API_KEY`, and a verified `EMAIL_FROM` address for request notifications.
- Set `BOOKING_FINALIZATION_RETRY_ENABLED=true` for paid supplier-finalization retries.
- Keep all gateway callback URLs public and configure the live credentials for each enabled gateway.
- Keep `BOKUN_MOCK_MODE=false` in production. Cancellation sync uses the configured Bókun cancel endpoint. Confirm the Bókun amendment endpoint and payload for date/traveler edits before enabling automatic amendment sync; unresolved amendments are intentionally marked `manual_action_required` instead of sending an unsafe supplier request.

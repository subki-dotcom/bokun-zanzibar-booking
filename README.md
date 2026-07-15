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

frontend/
  src/
    api/
    app/
    components/
      common booking tours checkout dashboard agents invoice
    context/
    hooks/
    layouts/
    pages/
      public admin agent
    routes/
    utils/
```

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
- `PAYPAL_SUCCESS_URL`
- `PAYPAL_CANCEL_URL`
- `PAYPAL_ALLOW_LOCAL_REDIRECTS` (default: `false`)
- `DEFAULT_CURRENCY`
- `FRONTEND_URL`

Required frontend vars:
- `VITE_API_BASE_URL` (example: `https://bokun-zanzibar-booking.onrender.com`)

Development fallback:
- `BOKUN_MOCK_MODE=true` enables mock Bokun layer for frontend and local development.
- `PESAPAL_MOCK_MODE=true` lets checkout run locally without hitting live Pesapal.
- `DPO_MOCK_MODE=true` lets checkout run locally without hitting live DPO.
- `PAYPAL_MOCK_MODE=true` lets checkout run locally without hitting live PayPal.
- In live Pesapal mode, callback URLs should be public unless `PESAPAL_ALLOW_LOCAL_REDIRECTS=true`.
- In live DPO/PayPal mode, success and cancel URLs should be public unless the matching `*_ALLOW_LOCAL_REDIRECTS=true` flag is intentionally enabled for local tests.

## Setup

1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

2. Configure env

```bash
# copy examples
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

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

5. Start frontend

```bash
cd frontend
npm run dev
```

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
- `POST /api/bokun/bookings`
- `GET /api/bokun/bookings/:reference`
- `POST /api/bokun/bookings/:bookingId/cancel`
- `POST /api/bokun/bookings/:bookingId/edit`

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
  - `BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS=180`
  - `BOOKING_FINALIZATION_RETRY_BATCH_SIZE=20`

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

Admin:
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
2. Choose the correct API base URL:
   - Sandbox: `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
   - Live: `PAYPAL_BASE_URL=https://api-m.paypal.com`
3. Set callback URLs:
   - `PAYPAL_SUCCESS_URL=https://<public-domain>/payment-success`
   - `PAYPAL_CANCEL_URL=https://<public-domain>/payment-failure`
4. Keep callback URLs public unless `PAYPAL_ALLOW_LOCAL_REDIRECTS=true` is intentionally enabled for local tests.

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

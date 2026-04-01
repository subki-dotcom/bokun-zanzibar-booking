# Zanzibar Bokun Integration Booking System

Production-oriented full-stack booking platform for Zanzibar tours and activities where **Bokun remains the only source of truth** for products, options, availability, capacity, pricing, and booking lifecycle.

## Core Principle

- Bokun is master for inventory and bookings.
- Local MongoDB stores snapshots and business layers only: analytics, invoices, offers, commissions, reports, audit logs, and portal UX acceleration.
- Every final booking is revalidated live and created in Bokun first.

## Tech Stack

- Frontend: React + React Bootstrap + Vite
- Backend: Node.js + Express
- DB: MongoDB + Mongoose
- Auth: JWT + RBAC
- HTTP: Axios + retry/timeout handling

## Project Structure

```text
backend/
  src/
    config/
    middleware/
    models/
    modules/
      auth users bokun tours bookings customers invoices agents
      commissions offers payments webhooks reports
    routes/
    utils/
    app.js
    server.js
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
- `PESAPAL_BASE_URL`
- `PESAPAL_AUTH_PATH`
- `PESAPAL_SUBMIT_ORDER_PATH`
- `PESAPAL_STATUS_PATH`
- `PESAPAL_CONSUMER_KEY`
- `PESAPAL_CONSUMER_SECRET`
- `PESAPAL_IPN_ID`
- `PESAPAL_SUCCESS_URL`
- `PESAPAL_CANCEL_URL`
- `PESAPAL_ALLOW_LOCAL_REDIRECTS` (default: `false`)
- `DEFAULT_CURRENCY`
- `FRONTEND_URL`

Development fallback:
- `BOKUN_MOCK_MODE=true` enables mock Bokun layer for frontend and local development.
- `PESAPAL_MOCK_MODE=true` lets checkout run locally without hitting live Pesapal.
- In live Pesapal mode, callback URLs should be public unless `PESAPAL_ALLOW_LOCAL_REDIRECTS=true`.

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
- `POST /api/bokun/booking-questions`
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
- `POST /api/payments/pesapal/create`
- `GET /api/payments/pesapal/success?OrderTrackingId=...`
- `GET /api/payments/pesapal/cancel?OrderTrackingId=...`
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
6. Frontend loads booking questions (`/api/bokun/booking-questions`).
7. Customer clicks **Confirm & Pay** and backend creates a local pending booking + Pesapal order (`/api/payments/pesapal/create`).
8. User is redirected to Pesapal payment page.
9. Frontend callback verifies payment (`/api/payments/pesapal/success`) before finalizing booking.
10. Backend confirms payment, creates booking in Bokun, then updates local snapshot/invoice/commission/payment logs.
11. If Bokun is temporarily unreachable during finalization, backend returns `paid_pending_finalization` (payment remains paid, booking stays pending) and retries can be triggered safely by re-calling success endpoint.

## Bokun Booking Sync (Webhook + Polling Fallback)

- Webhook: `POST /api/webhooks/bokun`
- Optional webhook secret header: `x-bokun-webhook-secret`
- Polling fallback:
  - `BOKUN_BOOKING_SYNC_ENABLED=true`
  - `BOKUN_BOOKING_SYNC_INTERVAL_SECONDS=300` (example)
  - `BOKUN_BOOKING_SYNC_BATCH_SIZE=20` (example)
- Manual fallback trigger (admin/staff): `POST /api/webhooks/bokun/poll`

The sync updates local booking snapshots (status/date/time/confirmation) from Bokun changes while keeping Bokun as source of truth.

## Bokun Integration Files

- `backend/src/modules/bokun/bokunClient.js`
- `backend/src/modules/bokun/bokunMapper.js`
- `backend/src/modules/bokun/bokun.service.js`
- `backend/src/modules/bokun/bokun.controller.js`
- `backend/src/modules/bokun/bokun.routes.js`

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

### Initialize Pesapal Payment
`POST /api/payments/pesapal/create`

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
  "paymentMethod": "pesapal",
  "amount": 140,
  "currency": "USD"
}
```

## Pesapal Live Checklist

Before using live Pesapal mode (`PESAPAL_MOCK_MODE=false`):

1. Set active credentials:
   - `PESAPAL_CONSUMER_KEY`
   - `PESAPAL_CONSUMER_SECRET`
   - `PESAPAL_IPN_ID`
2. Set callback URLs:
   - `PESAPAL_SUCCESS_URL=https://<public-domain>/payment-success`
   - `PESAPAL_CANCEL_URL=https://<public-domain>/payment-failure`
3. Keep callback URLs public unless `PESAPAL_ALLOW_LOCAL_REDIRECTS=true` is intentionally enabled for local tests.

Common API results:
- `HTTP 401/403`: auth or edge policy issue (confirm keys/IP/domain with Pesapal support).
- `PESAPAL_IPN_ID_MISSING`: register and configure a valid IPN ID before live checkout.

## Notes for Production Hardening

- Replace Bokun mock routes with your final Bokun endpoint paths/signing format.
- Add centralized structured logger sink (e.g. ELK, Datadog, CloudWatch).
- Add webhook signature validation once Bokun webhook signature contract is finalized.
- Add additional payment provider adapters (Stripe/manual/cash) behind `payments.service` abstraction.
- Add charts library (Recharts/Chart.js) to replace dashboard placeholders.

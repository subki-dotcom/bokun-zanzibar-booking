# GA4 and Google Ads implementation / release checklist

**Production update 2026-09-30:** the isolated frontend has now been deployed with authorization. See [production verification report](reports/analytics-production-verification-2026-09-30.md) for current status and observed duplicate SPA page views from Google-side history tracking. The implementation/pre-deployment notes below are historical; their no-deployment statements describe that earlier phase. Backend projection was not deployed with this frontend release.

Prepared 2026-09-30. Repository implementation only: no deployment, live payment, production database update, or Google account change was performed.

## Release status

Code implements the public booking funnel, a backend-derived purchase projection, browser purchase deduplication and a real consent banner/preferences interface. **Collection remains off until the visitor grants Analytics.** Code is prepared for an authorized deployment, conditional on the production environment and Google stream configuration below. Google delivery and Google-side automatic-event settings have not been verified. This document does not assert legal compliance; the owner must review the existing Privacy Policy against actual analytics/advertising use.

Configure Vercel Production before rebuilding:

```dotenv
VITE_GA_MEASUREMENT_ID=G-G4HFYGCFLH
VITE_GOOGLE_ADS_ID=
VITE_GOOGLE_ADS_BOOKING_LABEL=
VITE_GOOGLE_ADS_DIRECT_CONVERSIONS=false
VITE_ANALYTICS_DEBUG=false
```

These public values/placeholders are documented in `frontend/.env.example`. Existing local `.env` has no analytics keys. No actual environment file or Vercel settings were changed. The verification build used the specified GA4 ID through process environment variables. A missing ID disables analytics without affecting booking. No existing Google Ads destination or label was found in repository analytics code/configuration inspected; live Google account settings were not accessible. Never fill blanks with example IDs.

Deploy BOTH the additive backend projection and the frontend instrumentation, after authorization. Deploy backend first; a frontend with an older backend safely skips purchases because the projection is absent. Isolate these changes from the earlier uncommitted admin/password recovery and routing work. No payment/webhook/sync business logic was changed.

## Architecture and exact events

The existing `utils/analytics.js` tag was replaced in place, not supplemented with another installation. It wraps the testable `analyticsCore.js`. `AnalyticsTracker` handles public React-router navigations and contact clicks. `useBookingAnalytics` receives actual API responses from payment/confirmation/My Booking pages. There are no raw gtag calls in booking components.

| Event | Exact trigger | Data / purpose |
|---|---|---|
| `page_view` | Public navigation after consent; same router location key is not repeated | Sanitized location/path/title/referrer. No booking reference or payment query in page URLs. |
| `view_item` | Tour detail API data is loaded for the current slug; once per route visit | Catalog item ID/name; price/currency only if present and valid. Consent granted while on that tour retries the view. |
| `select_item` | User clicks View Details/View Experience in either tour card component | Selected catalog item and available price/currency. |
| `begin_checkout` | Public checkout has finished initialization and has a live quote and tour | Quote currency/value, item, guest count; once per visit. Viewing a tour alone does not emit it. |
| `booking_form_started` | First input interaction within the public checkout content | No field values; once per visit. |
| `booking_form_submitted` | Customer step validation succeeds and customer continues | Quote/item data, no customer fields. Not a purchase. |
| `booking_processing` | Payment initiation API succeeds, OR verified response says paid but supplier not yet confirmed | Initiation quote/item/provider where available; pending confirmation emits once per booking per visit. Not a purchase. |
| `booking_failed` | Payment initiation fails, or API reports failed payment | Fixed failure stage/category and allowlisted provider, never raw exceptions. Validation missing-answer prompts are not payment failures. |
| `booking_cancelled` | API booking state is cancelled | No query-string inference and no purchase. This is a diagnostic, not automatic financial refund reporting. |
| `purchase` | API returns eligible `analyticsPurchase` from the backend checks below | Stable transaction ID, verified amount/currency and one tour-package item. |
| `conversion` (optional Ads only) | Same purchase path, direct Ads flag, valid ID/label, advertising storage and user-data consent granted | Same transaction ID/value/currency; disabled by default. |
| `whatsapp_click` | Click on public link with exact wa.me/api.whatsapp.com/web.whatsapp.com host | Sanitized page context and `link_location=public_site`; no href/message/phone sent. |
| `phone_click` | Genuine public tel: link click | Sanitized page context only. |
| `email_click` | Genuine public mailto: link click | Sanitized page context only; no address/subject/body. |

No `add_shipping_info` is emitted: tours have no shipping step. The previous customer/payment diagnostics were mapped to booking events instead. Inputs are allowlisted at the analytics boundary; arbitrary event names and `trackAnalyticsEvent('purchase', ...)` are rejected. Purchase has its own entry point.

Illustrative ecommerce payloads (fixture values only; runtime uses actual catalog/quote/booking data):

```javascript
// view_item or select_item: catalog starting price, one tour package
{ currency: 'USD', value: 100,
  items: [{ item_id: '42', item_name: 'Spice tour', item_category: 'Tour', price: 100, quantity: 1 }] }
// begin_checkout: accepted live quote, not the starting/catalog price
{ currency: 'USD', value: 180, number_of_guests: 2,
  items: [{ item_id: '42', item_name: 'Spice tour', item_category: 'Tour', quantity: 1 }] }
// purchase: verified paid package, including selected extras as part of that package
{ transaction_id: 'RB-123', currency: 'USD', value: 180,
  items: [{ item_id: '42', item_name: 'Spice tour', item_category: 'Tour', price: 180, quantity: 1 }] }
```

`booking_form_submitted` and initiation `booking_processing` use the quote payload without fabricated missing currency/value. No customer name, email, phone, passport, form contents, card data or raw provider payload is mapped. Quantity 1 is a complete booking package, not a traveler count; `number_of_guests` supplies that separately when known. Missing catalog pricing is omitted, not reported as zero.

## Authoritative purchase confirmation

`getBookingByReference` adds `analyticsPurchase` using the pure read-only `services/bookings/analytics.js` projection. It returns null unless ALL relevant checks hold:

- Explicit `sourceChannel=direct_website`, `createdByRole=customer`, no agent ID; OTA imports, agent referrals/portal, admin bookings and recovery-created records fail closed.
- `paymentStatus=paid`, `bookingStatus=confirmed`, and a Bókun booking ID.
- `pendingCheckout.paymentVerifiedAt` and a non-mock payment transaction reference exist.
- Provider is Pesapal, PayPal or DPO; its mock mode and Bókun mock mode are off; configured sandbox/demo/test provider URLs are rejected.
- Positive finite numeric verified `paidAmount`, uppercase three-letter `paidCurrency`, stable booking reference and tour ID/title exist.
- Test flags and already refunded/partially refunded bookings are rejected.

The projection copies ONLY transaction ID, currency, value and tour item data. It neither changes a booking nor calls a gateway. Payment reference and verification timestamp are used as eligibility evidence but are not sent to GA.

Pesapal already verifies the gateway response, validates merchant reference/money, applies verified payment evidence and calls `markBookingPaymentVerified` before supplier finalization. Analytics reads the resulting evidence; browser redirects/IPN arrival alone are insufficient. Pesapal converted payments use the backend's verified **accountingAmount/accountingCurrency pair**, persisted as paidAmount/paidCurrency, so amounts are never paired with a different currency. This is normalized booking revenue, not a new independent FX calculation.

Bókun confirmation remains distinct from successful payment. Supplier-pending/manual-review bookings emit processing, not purchase. Existing sync/import/webhook/finalization code is unchanged. Bókun imports never initiate frontend events. Legacy paid records without explicit gateway evidence are intentionally excluded instead of guessed. Real paid tests in production cannot reliably be distinguished from real customers if they have identical data; use mock/sandbox/staging for testing, not a live production order.

Payment pages that return compact summaries fetch the existing booking-details API after paid+confirmed status to retrieve the safe projection. Confirmation and My Booking pages already receive it directly. Analytics API errors are caught and do not replace the normal UI or alter payment polling.

## Deduplication and delivery limits

- Stable `transaction_id` is the booking reference, never a newly generated event ID.
- Durable localStorage receipt key includes GA measurement ID and booking reference; memory guard handles re-renders.
- Web Locks serializes same-origin tabs when supported. Browsers without it retain localStorage and Google's transaction-ID deduplication; simultaneous old-browser tabs are not an exactly-once transport guarantee.
- Refresh/reopen/back-forward do not deliberately re-send an already queued purchase in the same browser/origin. Different browsers/devices/origins do not share localStorage. Stable transaction IDs support Google's web-stream deduplication for the same user, but do not guarantee global suppression for different user identities. Cross-domain identity configuration and transaction-level reconciliation are required; strict global at-most-once emission would require a separate server receipt/outbox design.
- If storage is blocked, purchase fails closed. Blocked scripts/network, denied consent, no return visit after asynchronous confirmation, or closed browsers can cause **undercounting**. Receipt means queued, not acknowledged by Google. No browser implementation guarantees delivery/exactly-once across network failures.
- There is no server Measurement Protocol sender/outbox here. It would require separate secure configuration, consent/attribution propagation, and coordination with browser events; do not add a second sender casually. Revenue reporting must be reconciled against backend bookings.

Google documents web-stream transaction deduplication: https://support.google.com/analytics/answer/12313109

## Implemented consent and privacy controls

Basic consent behavior: no Google script or analytics event until analytics_storage is granted. `main.jsx` synchronously restores consent before mounting React. The Google command queue receives four default-denied Consent Mode v2 signals before any config/event, followed by the actual saved choice, if valid. No external CMP integration is required for this banner.

- Accept All grants Analytics and Advertising; Reject Optional denies both. Both use equal button styling. Manage Preferences provides independent Analytics/Advertising switches; Necessary is always enabled.
- Analytics maps to analytics_storage; Advertising maps to ad_storage, ad_user_data and ad_personalization. Advertising alone does not load GA4; imported GA4 purchase measurement needs Analytics too. Empty Ads configuration never creates a fake destination.
- First-party localStorage key `riser_cookie_consent_v1` stores only version, two category booleans and updatedAt. Choices expire after 180 days; expiry is checked on startup and when returning to the visible tab. Invalid/future/expired records default to denied. Same-origin tabs synchronize via storage events; different domains/origins have independent choices.
- Cookie Preferences in the public footer reopens the dialog. Save, Accept and Reject update Google consent immediately. Closing the dialog does not grant consent. React Bootstrap supplies dialog focus containment, Escape and focus restoration; labelled native controls, visible focus, equal touch targets and mobile stacking are included.
- If storage writes fail, the current visit retains the real choice and a visible notice explains it was not saved. Optional failures are isolated from booking. Revocation stops subsequent application events and deletes known accessible first-party Google analytics/ads cookies for denied categories. It cannot delete third-party or HttpOnly cookies; auth, booking storage and purchase receipts are preserved.
- The existing Privacy Policy is linked and unchanged. This is a technical consent implementation, not legal approval. No new runtime dependency was added; jsdom is a development-only DOM testing dependency.

The retained analytics API maps actual choices as follows (the new consent store invokes it):

```javascript
import { updateAnalyticsConsent } from './utils/analytics';
// Map booleans from your real CMP, NOT hardcoded acceptance:
updateAnalyticsConsent({
  analytics_storage: cmp.analytics ? 'granted' : 'denied',
  ad_storage: cmp.advertisingStorage ? 'granted' : 'denied',
  ad_user_data: cmp.advertisingUserData ? 'granted' : 'denied',
  ad_personalization: cmp.personalization ? 'granted' : 'denied'
});
```

The existing external `riser:consent-update` bridge remains available but is not needed by this interface; do not install a competing consent manager or another Google tag. Saved choices are replayed on every full load. Pre-consent funnel actions are not retrospectively replayed; current page/tour/confirmed purchase can be observed when consent is subsequently granted.

The loader has one script marker and one initialization guard. Config sets `send_page_view:false`; application page views are keyed by router location and repeated effects/consent notifications do not repeat the same page. Tests exercise initial load, SPA movement and back/forward keys. **Google Enhanced Measurement history events are separate:** the documented gtag `send_page_view` flag does not disable them. There is no supported blanket gtag config switch used here to disable that remote setting. Disable automatic page views/history changes in the web stream before launch and confirm actual network events after deployment. No unsupported Google transport/history monkeypatch was introduced, and remote duplicate-free delivery is not claimed.

Production host allowlist: canonical domain, www, and existing `bokun-zanzibar-booking.vercel.app` production alias (current payment callback defaults use it). Localhost and Vercel preview hosts are excluded. Logged-in admin/agent sessions are excluded even on public pages. Private routes do not emit application events; GA is suspended when leaving public layout. Do not install another Google tag via CMP/GTM/Vercel in parallel.

URLs are sanitized: query strings and hashes are omitted except validated opaque Google click IDs and restricted standard UTM campaign identifiers on landing/tour pages. Existing routing/redirect URLs are not rewritten by analytics. Payment/reference paths become generic paths. Referrer is reduced to origin. Use non-PII campaign naming; do not place customer data in UTM values. Automatic Google events MUST be configured as below to avoid bypassing this allowlist.

Enhanced Conversions are **not implemented or enabled**. No `user_data` is sent. Additional Ads terms/account configuration, consent and a reviewed dedicated first-party-data flow are required before enabling them. Disable automatic user-provided-data collection in Google tag settings; do not scrape booking forms.

Google Consent Mode: https://developers.google.com/tag-platform/security/guides/consent

## Manual Google setup

1. GA4 Admin → Data streams → the web stream for **G-G4HFYGCFLH**. Confirm the canonical site URL.
2. **Disable Enhanced Measurement automatic page views, including browser-history page changes.** This implementation owns page_view. `send_page_view:false` alone does not turn off history-based Enhanced Measurement. Also disable automatic form interactions, outbound clicks and site search for this stream so full hrefs/form metadata/query text are not collected independently. Review other Google-configured tags/events for sensitive URL capture.
3. Verify `purchase` with transaction_id/value/currency/items in DebugView before treating it as a business key event. Do not create URL-based success-page purchase rules.
4. In GA4 Google Ads product links, link the correct account; enable Ads auto-tagging. Review unwanted referrals for your payment providers. Configure cross-domain measurement for the canonical and existing production alias if checkout really crosses between them; do not add a third-party payment domain you cannot tag/control. Check that existing payment return URLs preserve the customer journey. This task did not modify gateway callback settings.
5. In Google Ads Goals/Conversions, create/import the GA4 `purchase` key event conversion from the linked property. Verify dynamic conversion values/currency, transaction identifiers and appropriate counting (normally every distinct purchase).
6. Select ONE authoritative booking conversion as Primary for bidding after verification and business approval. Keep checkout/form/WhatsApp diagnostics Secondary unless your business intentionally chooses otherwise. Imported actions may start Secondary; verify the actual setting.
7. Leave direct Ads mode false when using imported GA4 purchase. If a direct Ads action is deliberately chosen instead, supply its REAL AW ID and booking label and enable `VITE_GOOGLE_ADS_DIRECT_CONVERSIONS=true`; keep the overlapping imported action Secondary/excluded from primary goals. Do not count both as two primary sales.
8. If an existing Google-side tag collects user data or duplicates page_view/purchase, resolve that before launch. Repository inspection cannot verify remote account configuration.

Official references: https://developers.google.com/analytics/devguides/collection/ga4/views and https://support.google.com/google-ads/answer/2375435 and https://support.google.com/google-ads/answer/10632359

## Verification after authorized deployment

1. Confirm deployed frontend contains the intended measurement ID and backend returns analyticsPurchase null for pending/failed/non-direct bookings. Never paste full customer API payloads into logs/tickets.
2. With a clean consent state, test Reject Optional first: no Google script/collection request. Reopen via footer, grant Analytics only: one async tag, one page_view; advertising remains denied. Revoke: no subsequent application events. Reload and navigate to confirm persistence. Test Accept All, Advertising-only, Escape/close without saving, keyboard focus and small-screen layout. Use a separate browser profile so purchase receipts are not cleared accidentally.
3. Use Google Tag Assistant with a controlled browser. Verify one installation and check network collection requests. Use a separate test GA property in a controlled test build for synthetic receipts; never manufacture production purchases. Debug mode is an explicit build variable, not a public URL query toggle.
4. Run landing → tour card → tour detail → booking/live quote → edit customer step → continue → payment initialization. Check each event against the table. Verify no ordinary purchase on Book Now, customer submit, payment redirect, failure or a manually opened success URL.
5. Existing sandbox/mock payments deliberately cannot become production purchases. For a live conversion, observe an authorized genuine customer booking; do not charge/refund a production booking just to test this implementation. Tests provide synthetic verified-state coverage without calling either provider.
6. For a genuine completed direct booking, verify backend paid evidence and Bókun confirmation, then inspect ONE purchase in Tag Assistant/GA4 DebugView. Compare normalized booking amount/currency and stable transaction ID to the backend. Check item ID/title and package quantity.
7. Refresh, back/forward, reopen confirmation, and open a second tab: no extra application purchase. Use GA4 transaction ID reporting/Explore (or export) to verify one transaction after processing. Across origins/devices verify the stable identifier rather than expecting shared localStorage.
8. Inspect GA4 Realtime for current traffic and event names; processed Monetization/Ecommerce purchases and Explore for revenue/item revenue, source/medium/campaign, landing pages and funnel conversion rate. Processing is not instantaneous. Register custom dimensions such as failure_stage/provider/link_location only if needed for Explore; avoid transaction IDs as high-cardinality custom dimensions.
9. In Google Ads conversion diagnostics, verify the selected primary booking action, dynamic values and consent/tag status. Ads attribution requires eligible ad interaction and may differ from GA totals. Do not click your own ads merely to generate a test conversion.
10. Verify normal public navigation, checkout, gateway return and Bókun finalization still work, including ad blocker/storage disabled cases. No real browser/provider/Google account end-to-end validation was performed in this workspace.

## Files in this analytics change

- `backend/src/services/bookings/analytics.js` — new eligibility/projection helper.
- `backend/src/services/bookings/index.js` — additive analyticsPurchase field in existing public details response.
- `backend/test/analyticsPurchase.test.js` — authoritative-state/exclusion/PII projection tests.
- `frontend/.env.example` — GA4 ID and optional Ads/debug configuration.
- `frontend/src/utils/analyticsCore.js` — consent, initialization, allowlists, events and deduplication.
- `frontend/src/utils/analytics.js` — environment-backed reusable API.
- `frontend/src/components/common/AnalyticsTracker.jsx` — router/CMP bridge/contact clicks.
- `frontend/src/hooks/useBookingAnalytics.js` — API-confirmed purchase observation.
- `frontend/src/components/tours/TourCard.jsx` — selection.
- `frontend/src/components/tours/listing/TourCard.jsx` — selection.
- `frontend/src/pages/public/TourDetailsPage.jsx` — detail view.
- `frontend/src/pages/public/BookingFlowPage.jsx` — checkout, form, processing/failure.
- `frontend/src/pages/public/BookingConfirmationPage.jsx` — verified purchase observation.
- `frontend/src/pages/public/PaymentSuccessPage.jsx` — verified purchase observation.
- `frontend/src/pages/public/PaymentStatusPage.jsx` — verified purchase observation.
- `frontend/src/pages/public/PaymentFailurePage.jsx` — verified result observation, not URL-based failure/purchase.
- `frontend/src/pages/public/MyBookingPage.jsx` — returned/reopened verified booking observation.
- `frontend/test/analytics.test.js` — tag/consent/funnel/privacy/dedup/Ads/error-safety tests.
- `ANALYTICS_IMPLEMENTATION.md` — this report and verification guide.

Consent completion adds/updates: `frontend/src/utils/consentStore.js`, `frontend/src/utils/consent.js`, `frontend/src/components/common/CookieConsent.jsx`, `frontend/src/components/common/cookieConsent.css`, `frontend/src/main.jsx`, `frontend/src/layouts/PublicLayout.jsx`, `frontend/src/components/common/footer/FooterBottom.jsx`, `frontend/src/utils/analyticsCore.js`, `frontend/test/consent.test.js`, `frontend/test/consentUi.test.js`, `frontend/package.json`, `frontend/package-lock.json`, and this document. The existing funnel and authoritative backend projection were preserved.

Earlier admin/password-recovery files and pre-existing AppRoutes lazy-import changes are not part of this analytics change and were preserved.

## Automated verification

- Frontend `npm test`: 169 passed, zero failures (includes eight existing analytics tests, five consent-store tests and three rendered DOM tests).
- Backend selected regression suite: 32 tests, zero failures: analyticsPurchase, pesapalPaymentState, pesapalStatus.validation, pesapalIpnRoute, paymentCallbacks.validation, bokunPaymentRecovery, bokunBookingAnswers.
- Production `npm run build` and `npm run verify:seo` using the specified production site/API/GA values: passed; 40 public pages, 38 tours, zero duplicate/invalid sitemap URLs.
- Targeted backend ESLint: zero errors; five pre-existing unused-variable warnings in bookings/index.js.
- Full backend `npm run lint`: pre-existing four errors / 30 warnings in unchanged files: config/db.js:19, scripts/bokunIdentityAudit.js:5, services/bokun/index.js:176, services/webhooks/index.js:654. Not silently fixed outside scope.
- No frontend lint or TypeScript/typecheck script exists in package.json; this is JavaScript/JSX. Build checks JSX/module compilation.
- Fresh frontend `npm audit --json`: 13 dependency findings (6 high, 6 moderate, 1 low). Every flagged installed package/version already exists unchanged in HEAD's lockfile: @babel/core, @remix-run/router, axios, baseline-browser-mapping, browserslist, esbuild, follow-redirects, form-data, nanoid, postcss, react-router, react-router-dom, vite. No finding names the new jsdom dependency. These are existing release risks requiring separate dependency triage; no unrelated automatic upgrades were performed.
- `git diff --check`: run before handoff. jsdom 26.1.0 was added only as a development dependency for real component tests. No production financial/database writes.

Passing automated tests is not proof that Google received a live purchase. Release remains conditional on deployment configuration and the Google-side verification above. DOM tests exercise controls, modal keyboard behavior and focus; they do not replace visual mobile/desktop or real Google network verification.

## Exact DebugView journey after authorized deployment

Use Tag Assistant/debug mode in a controlled browser and the intended property. Synthetic mocked eligibility tests belong in the automated suite or a separate test property; sandbox/mock bookings remain excluded from production purchase tracking. An actual paid test needs explicit authorization and must not bypass eligibility checks.

1. Open the website with clean consent state.
2. Confirm optional tracking is not sent before consent.
3. Accept Analytics consent.
4. Verify one page_view.
5. Open a tour.
6. Verify view_item.
7. Start booking.
8. Verify begin_checkout.
9. Submit the booking form; check booking_form_started/submitted without field values.
10. Verify booking_processing.
11. Complete an explicitly authorized eligible booking/payment; wait for backend payment verification AND Bókun confirmation.
12. Verify exactly one purchase.
13. Verify transaction_id against the booking reference.
14. Verify value against the verified paid amount.
15. Verify currency against the corresponding verified currency.
16. Refresh the confirmation page.
17. Confirm no second purchase; also test a second tab and back/forward.

## Deployment and owner checklist (not executed)

- **Repository/backend:** isolate analytics changes from unrelated auth work. Obtain deployment authorization for the additive backend projection and frontend; deploy the projection first if absent. Do not redeploy financial logic as part of this task.
- **Vercel Production:** set `VITE_GA_MEASUREMENT_ID=G-G4HFYGCFLH`; leave Ads ID/label blank or unset; set direct conversions and debug false as above. Preserve the existing production site/API variables. Rebuild and deploy only after authorization. Verify one asynchronous Google script after consent and none before it.
- **GA4:** confirm the correct property/web stream; disable automatic page/history views, form interactions, outbound clicks and site-search collection for this manual implementation. Check Realtime, run the complete DebugView journey, then validate ecommerce revenue and transaction IDs. Make purchase a key event if required by the current conversion setup. Review provider referrals and cross-domain identity where used.
- **Google Ads:** link that GA4 property to the correct Ads account; confirm auto-tagging. Import/create purchase from the linked GA4 property, select the intended single Primary completed-booking conversion, check dynamic value/currency and transaction IDs, and verify conversion diagnostics/activity after an eligible booking. Keep overlapping actions Secondary; do not enable direct Ads mode as a second Primary. Check actual ad-attributed source/medium/campaign without inventing click IDs or clicking your own ads. No real AW ID or label was available; neither is required for the chosen GA4-import model.
- **Consent:** verify Accept, Reject, Manage Preferences, independent categories, reload persistence, footer reopening, revocation, mobile/desktop layout and keyboard access. Have the owner review policy wording. Existing Google cookies outside JavaScript access may require provider-specific privacy management.
- **Privacy:** inspect actual collection requests for sanitized URLs and allowlisted payloads, no form values/customer contact data; Enhanced Conversions stays off. No secrets belong in VITE variables. Monitor booking/payment navigation with blocked Google scripts.

Target remains one eligible confirmed booking → one GA4 purchase → one Primary Google Ads booking conversion, subject to the explicitly documented browser delivery and cross-device deduplication limits.

Final readiness: implementation and scoped automated checks pass. This is **conditional code readiness, not unconditional production sign-off**: remote GA4 settings, production environment, browser/network verification, policy review and existing lint/dependency findings remain owner/release checks. No deployment, push, Google account mutation or production booking/payment was performed. Tests use spies/mocks and never send real Google events. Build prerender only reads the existing public tour API.

# Analytics production deployment verification — 2026-09-30

## Outcome

Frontend production deployment succeeded. Analytics verification is **not an unconditional pass**: live Google Enhanced Measurement history tracking duplicates the application's SPA page_view, and the observed page_view hit is marked as a conversion. Google account settings were not changed.

- Production: https://zanzibartoursandsafaris.co.tz
- Deployment: https://vercel.com/subki-dotcoms-projects/bokun-zanzibar-booking/Hu1dp2nETycFZuHy6G2RqAAhTm4o
- Immutable URL: https://bokun-zanzibar-booking-gpvmy69cc-subki-dotcoms-projects.vercel.app
- Vercel result: READY, target production; canonical domain alias assigned.
- Base: 4de2dcb6f7fc40de07f9fcc2eced28482db0348d plus 26 explicitly allowlisted frontend analytics/config/test files. No unrelated auth/password-recovery or lazy-routing changes. Comparison of all other source files to HEAD found zero content changes (line endings normalized).
- Local release: `.tools/analytics-release-20260930`. Built using Vercel Production configuration and deployed with `vercel deploy --prebuilt --prod --yes` to the existing project. No GitHub push, new project, Render/backend deployment, environment setting changes or financial business-logic changes.
- Production bundle `/assets/index-FVPT_AH-.js` exactly matches the verified artifact; SHA256 `d289a4ad9d696c4c65629a5a075d2df3c94cc1e7bce3abb2b2a457d6c078abe0`.

## Build and HTTP evidence

- Isolated frontend tests: 165 passed, 0 failed. Four unrelated auth/admin tests from the main working directory intentionally absent.
- Isolated npm production build, Vercel production build and verify:seo: passed. Prerender 40 pages, 38 tours.
- Production /, /tours and three real tour pages: HTTP 200, prerendered H1 and correct canonical. Sitemap/robots HTTP 200; 40 sitemap URLs, 0 duplicates, 0 invalid URLs; correct robots Sitemap directive.
- HTTP evidence saved locally in `.tools/analytics-release-20260930/live-http.json`.
- Vercel Production values verified: G-G4HFYGCFLH; analytics debug false; direct Ads conversions false; correct public API and canonical domain. SEO_API_BASE_URL is marked sensitive in Vercel and cannot be pulled; only its local build placeholder was replaced by the user's already-provided public API URL. Cloud values unchanged.

## Live browser results

| Check | Result / evidence |
|---|---|
| Desktop site | Homepage, tours and tour detail rendered; catalog loaded 38 tours. |
| Mobile | Narrow-viewport tour rendering observed, including collapsed navigation and mobile booking bar. Preferences controls worked by keyboard; screenshot capture of the modal was unreliable, so complete mobile visual sign-off is not claimed. |
| Consent defaults | Tag Assistant shows all four Consent Mode v2 signals default Denied before config. |
| Accept All | Both optional switches saved checked; Tag Assistant shows four Granted updates. |
| Reject Optional | Choice survives reload; no Google tag script after rejection/reload. Reopened switches unchecked. A separate live all-denied update was not captured in Tag Assistant, so no claim of that specific remote observation. |
| Preferences | Footer reopens labelled dialog; Necessary locked on; Analytics and Advertising independent; Analytics-only saved and reflected in checkout hit consent (advertising denied, analytics granted). |
| Google tag | No tag before consent; one marked gtag script after consent with G-G4HFYGCFLH; remains one across normal SPA navigation. Tag Assistant detects one Google tag. |
| page_view | Actual GA4 hit received in Tag Assistant. **Duplicate SPA hits confirmed:** message 63 `gtag('event','page_view',...)` and message 64 `gtm.historyChange-v2` each sent a GA4 Page View for the same transition. Back navigation also produced the two history paths. |
| view_item | Tag Assistant message 59 emitted view_item and shows View Item hit to G-G4HFYGCFLH; returning to the tour produced a new visit event. |
| begin_checkout | Message 46 emitted begin_checkout and shows actual Google Analytics collect hit: USD 230, one guest, item 1175398, package quantity 1. |
| Booking flow | Selected future date, live quote, option and 09:00 start time; reached customer details. No form submission, booking creation or payment initiation/completion. |
| PII | Inspected actual page_view and begin_checkout payloads: no customer name/email/phone/passport/payment credentials. Checkout URL query stripped from application event; title generic. This does not certify every remotely configured automatic event or future customer submission. |
| Console | No analytics exception observed. Automation focus generated existing date-picker showPicker/user-gesture errors; unchanged date component confirmed. Checkout also logged `Unable to prefetch Bokun booking questions`. Neither was fixed outside scope; full zero-error sign-off is not claimed. |

The date fill initially did not commit a React change in browser automation; keyboard date selection resolved it and availability/checkout proceeded. That initial disabled button was not evidence of a booking regression.

## Required owner actions

1. GA4 Admin → Data streams → G-G4HFYGCFLH web stream → Enhanced Measurement → Page views advanced settings: disable browser-history-based automatic page views for this manually tracked SPA. Re-test one GA4 page_view per initial load, forward/back and route transition. Do not remove the application's manual tracker.
2. Review GA4 key-event/conversion configuration: the inspected page_view carries `_c=1` and Tag Assistant shows Conversion alongside Page View. Page visits must not represent completed bookings. Keep the intended completed-booking key event as purchase; inspect related Google Ads action settings before bidding.
3. Live Google tag includes existing destination **AW-10869002251**, although direct Ads mode is false and no Ads label is configured in repository variables. This is a Google-side linked destination, not a new tag installed by this deployment. Review its existing actions/automatic collection before importing purchase; do not create two Primary booking conversions.
4. Review Enhanced Measurement form/outbound/search collection and user-provided-data settings; application allowlists do not control remotely enabled automatic collectors. Verify GA4 Realtime/DebugView/property reporting after correcting settings.
5. Backend analyticsPurchase projection was **not deployed or verified in this frontend-only release**. Confirm its rollout separately before claiming live purchase readiness. No real paid conversion or purchase deduplication was exercised in production.
6. Review the existing booking-question prefetch warning and date-picker user-gesture handling separately if reproducible during ordinary use. Existing dependency/lint findings remain documented in ANALYTICS_IMPLEMENTATION.md.

No Google Ads/GA4 account configuration was modified. Tag Assistant was used only for browser diagnostics. No real paid booking, Search Console action, production database write or accounting/payment/Bókun business-logic modification was performed.

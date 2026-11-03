# Google Analytics and Tag Manager

The public site loads GTM-PF7LKQ72 through analyticsCore after Analytics consent is granted.
Consent defaults and updates use the shared dataLayer. Production host, public route and
internal-session checks also apply. There is no noscript iframe that bypasses these checks.

GA4 remains owned by the existing application integration using VITE_GA_MEASUREMENT_ID.
Do not publish another Google tag or GA4 event tags for that same destination in GTM
without a coordinated migration: doing so can duplicate page views and purchases.
The published GTM container was inspected on 2026-10-25 and contained no tags.

Any future container tags must respect consent updates, including withdrawal, and must
not collect private booking references, payment URL parameters or internal/admin activity.
The container remains loaded during SPA navigation; configure future tag triggers accordingly.
Advertising tags require the corresponding advertising consent, independently of Analytics.

Verify with Tag Assistant Preview and GA4 Realtime after deployment. A container being
installed does not mean that additional tags or conversion tracking have been configured.

## Google Ads (AW-18541089433)

The Google Ads tag of Zanzibar Tours & Safaris (`AW-18541089433`, set in `src/utils/analytics.js`, overridable with
`VITE_GOOGLE_ADS_ID`) is configured through the same Google tag only after the visitor accepts advertising cookies
(`ad_storage` granted); with Analytics-only consent it is not loaded. Purchase conversions are sent only when
`VITE_GOOGLE_ADS_BOOKING_LABEL` (the conversion label from Google Ads) is set and `VITE_GOOGLE_ADS_DIRECT_CONVERSIONS=true`,
once per booking, from the verified purchase receipt. The Ads tag is configured with `allow_enhanced_conversions: true`.
Nothing is sent to Google before the visitor's choice (basic consent mode).

Conversions:
- Contact form (`/contact`): only after `POST /api/marketing/contact` succeeds, never for honeypot submits, once per
  submission: GA4 `generate_lead` (form_name `contact`, 1.0 USD, needs Analytics consent) and the Ads conversion
  `AW-18541089433/<VITE_GOOGLE_ADS_CONTACT_LABEL>` (default `tMbNCIOd-a8dEJmliolF`, needs advertising consent).
- WhatsApp / tel: / mailto: links (`src/utils/clickTracking.js`, one capture-phase document listener): GA4
  `whatsapp_click` / `phone_click` / `email_click` with `link_location` (Analytics consent); an Ads conversion too when
  `VITE_GOOGLE_ADS_WHATSAPP_LABEL` / `VITE_GOOGLE_ADS_PHONE_LABEL` is set (advertising consent). Add
  `data-track-location="…"` to a link to name its place explicitly.
- Google Ads conversion "ZANZANZIBAR TOURS PROPART 2 (web) whatsapp_click" is event-based (no label): with advertising
  consent every WhatsApp click also sends `whatsapp_click` to `AW-18541089433`. WhatsApp links open in a new tab, so
  the snippet's delayed-navigation helper is not needed.

Enhanced conversions: with `ad_user_data` granted, `gtag('set', 'user_data', { email, phone_number })` (email trimmed
and lowercased, phone only in E.164) runs right before the contact conversion and the purchase events; gtag hashes it.
For bookings the checkout keeps the guest's email/phone in this tab's sessionStorage (`zts:ads_user_data`, 6 hours,
removed after the purchase or when advertising consent is withdrawn) so the purchase page can use it after the
payment provider. These details are never logged or sent anywhere else.

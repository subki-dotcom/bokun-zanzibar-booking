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

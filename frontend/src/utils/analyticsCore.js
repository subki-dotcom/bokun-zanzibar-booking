const DENIED = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
// Booking funnel: view_item -> select_date -> check_availability -> select_option -> begin_checkout ->
// add_shipping_info (customer details) -> add_payment_info -> purchase (sent by purchase()).
const EVENTS = new Set(['view_item', 'select_item', 'select_travelers', 'select_date', 'check_availability', 'select_option', 'begin_checkout',
  'add_contact_info', 'add_pickup_info', 'add_shipping_info', 'add_payment_info', 'booking_form_started', 'booking_form_submitted',
  'booking_processing', 'booking_failed', 'booking_cancelled', 'whatsapp_click', 'phone_click', 'email_click', 'generate_lead',
  // My booking: sent without parameters (no reference or personal data).
  'view_booking', 'download_ticket', 'add_to_calendar', 'change_request', 'cancel_request']);
// Where a WhatsApp / phone / email link was clicked (picked by clickLocation() in clickLocation.js).
export const LINK_LOCATIONS = ['header', 'mega_menu', 'mobile_menu', 'search_panel', 'footer', 'floating_button', 'home_hero',
  'contact_page', 'contact_form_result', 'tours_page', 'tour_page', 'checkout', 'payment', 'booking_confirmed', 'my_booking',
  'booking_lookup', 'page', 'public_site'];
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Enhanced conversions: email trimmed + lowercased, phone only in E.164. gtag hashes them; nothing else sees them.
export const cleanUserData = (input = {}) => {
  const output = {};
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone_number === 'string' ? input.phone_number.trim() : '';
  if (EMAIL.test(email) && email.length <= 254) output.email = email;
  if (E164.test(phone)) output.phone_number = phone;
  return output;
};
const USER_DATA_KEY = 'zts:ads_user_data';
const USER_DATA_TTL_MS = 6 * 60 * 60 * 1000;
const text = (v) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 150) : '';
const money = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const safePath = (path = '/') => {
  if (/^\/(admin|agent|login|forgot-password|reset-password|invoice)(\/|$|-)/.test(path)) return null;
  if (/^\/booking\/confirmed(\/|$)/.test(path)) return '/booking/confirmed';
  if (/^\/(my-booking|booking-confirmation|payment-status)(\/|$)/.test(path)) return `/${path.split('/')[1]}`;
  if (path.startsWith('/payment/checkout/')) return '/payment/checkout';
  if (/^\/payment-(success|failure|processing)$/.test(path)) return path;
  if (['/', '/tours', '/privacy', '/terms', '/about', '/contact', '/faq', '/cancellation-policy'].includes(path) || /^\/(tours|booking)\/[a-z0-9-]+$/.test(path)) return path;
  return null;
};
export const cleanEcommerce = (input = {}) => {
  const output = {};
  if (/^[A-Z]{3}$/.test(input.currency || '') && money(input.value)) { output.currency = input.currency; output.value = input.value; }
  if (Array.isArray(input.items)) output.items = input.items.slice(0, 20).flatMap((item) => {
    const id = text(item.item_id), name = text(item.item_name);
    return id && name ? [{ item_id: id, item_name: name, item_category: 'Tour',
      quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
      ...(money(item.price) ? { price: item.price } : {}) }] : [];
  });
  if (Number.isInteger(input.number_of_guests) && input.number_of_guests > 0) output.number_of_guests = input.number_of_guests;
  return output;
};
export const createAnalytics = (config = {}, browser = () => typeof window === 'undefined' ? null : window) => {
  const state = { configured: false, consent: { ...DENIED }, page: '', seen: new Set(), purchases: new Set(), leads: new Set() };
  const label = (value) => (/^[A-Za-z0-9_-]+$/.test(value || '') ? value : '');
  const guard = (fn) => (...args) => { try { return fn(...args); } catch { return false; } };
  const prepareConsent = () => {
    const w = browser();
    if (!w) return;
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    if (!w.__ztsConsentDefaultsInitialized) {
      w.gtag('consent', 'default', { ...DENIED });
      w.__ztsConsentDefaultsInitialized = true;
    }
  };
  const eligible = () => {
    const w = browser();
    return w && config.production && /^G-[A-Z0-9]+$/.test(config.measurementId || '') &&
      ['zanzibartoursandsafaris.co.tz', 'www.zanzibartoursandsafaris.co.tz', 'bokun-zanzibar-booking.vercel.app'].includes(w.location.hostname) &&
      safePath(w.location.pathname) !== null && !w.localStorage.getItem('zanzibar_auth_token');
  };
  const locationData = () => {
    const w = browser(), path = safePath(w.location.pathname), url = new URL(path, w.location.origin);
    // No arbitrary query strings, booking references or provider credentials.
    if (path === '/' || path === '/tours' || path.startsWith('/tours/')) {
      const search = new URLSearchParams(w.location.search);
      for (const key of ['gclid', 'dclid', 'gbraid', 'wbraid']) {
        const value = search.get(key);
        if (value && /^[a-zA-Z0-9_.~-]{1,500}$/.test(value)) url.searchParams.set(key, value);
      }
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term']) {
        const value = search.get(key);
        if (value && /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(value)) url.searchParams.set(key, value);
      }
    }
    let referrer = '';
    try { referrer = new URL(w.document.referrer).origin; } catch { /* no referrer */ }
    return { page_path: path, page_location: url.href, page_referrer: referrer,
      page_title: path.startsWith('/tours/') || path === '/' || path === '/tours' ? text(w.document.title) : 'Zanzibar booking' };
  };
  const initializeTagManager = guard(() => {
    const w = browser();
    if (state.consent.analytics_storage !== 'granted' || !/^GTM-[A-Z0-9]+$/.test(config.gtmId || '') ||
        w.__ztsTagManagerInitialized) return;
    const script = w.document.createElement('script');
    script.async = true;
    script.dataset.ztsTagManager = 'true';
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(config.gtmId)}`;
    // Consent defaults and the visitor's choice are already in this shared dataLayer.
    w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    w.document.head.appendChild(script);
    w.__ztsTagManagerInitialized = true;
  });
  // Loads the Google tag on eligible public pages (it only sends anything once the visitor has consented).
  // Returns whether this page may be measured at all.
  const ready = guard(() => {
    const w = browser();
    prepareConsent();
    if (!eligible()) return false;
    initializeTagManager();
    // Route-effect cleanup suspends collection; resume only on eligible public pages.
    w[`ga-disable-${config.measurementId}`] = false;
    const route = `${w.history?.state?.key}:${w.location.pathname}`;
    if (state.route !== route) { state.route = route; state.seen.clear(); }
    if (!state.configured && !w.__ztsAnalyticsInitialized) {
      w.gtag('set', 'ads_data_redaction', true);
      w.gtag('js', new Date());
      w.gtag('config', config.measurementId, { send_page_view: false, ...locationData(), allow_google_signals: false });
      if (!w.document.querySelector('script[data-zts-google-tag]')) {
        const script = w.document.createElement('script');
        script.async = true; script.dataset.ztsGoogleTag = 'true';
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`;
        w.document.head.appendChild(script);
      }
      state.configured = w.__ztsAnalyticsInitialized = true;
    } else if (w.__ztsAnalyticsInitialized) {
      state.configured = true;
    }
    // The Google Ads tag: only once the visitor has accepted advertising cookies (it may come later than Analytics).
    if (/^AW-\d+$/.test(config.adsId || '') && state.consent.ad_storage === 'granted' && !w.__ztsAdsInitialized) {
      w.gtag('config', config.adsId, { send_page_view: false, allow_enhanced_conversions: true, ...locationData() });
      w.__ztsAdsInitialized = true;
    }
    return true;
  });
  // True when the page is eligible AND Analytics consent is granted.
  const initialize = guard(() => ready() === true && state.consent.analytics_storage === 'granted');
  // Google Ads conversions: eligible page, advertising consent, and the Ads tag configured.
  const adsAllowed = () => ready() === true && state.consent.ad_storage === 'granted' && Boolean(browser().__ztsAdsInitialized);
  const setUserData = (input) => {
    if (state.consent.ad_user_data !== 'granted') return false;
    const userData = cleanUserData(input);
    if (!userData.email && !userData.phone_number) return false;
    browser().gtag('set', 'user_data', userData);
    return true;
  };
  const storage = () => { try { return browser()?.sessionStorage || null; } catch { return null; } };
  const forgetUserData = () => { try { storage()?.removeItem(USER_DATA_KEY); } catch { /* storage blocked */ } };
  const savedUserData = () => {
    try {
      const saved = JSON.parse(storage()?.getItem(USER_DATA_KEY) || 'null');
      if (saved && Number.isFinite(saved.at) && Date.now() - saved.at < USER_DATA_TTL_MS) return saved.data || null;
      forgetUserData();
    } catch { /* storage blocked */ }
    return null;
  };
  const consent = guard((choices = {}) => {
    prepareConsent();
    for (const key of Object.keys(DENIED)) state.consent[key] = choices[key] === 'granted' ? 'granted' : 'denied';
    browser()?.gtag('consent', 'update', { ...state.consent });
    if (state.consent.ad_user_data !== 'granted') forgetUserData();
    initialize();
    browser()?.dispatchEvent(new Event('zts:analytics-consent'));
    return true;
  });
  const send = (name, payload) => {
    if (!initialize()) return false;
    browser().gtag('set', locationData());
    browser().gtag('event', name, { ...locationData(), ...payload, send_to: config.measurementId,
      ...(config.debug ? { debug_mode: true } : {}) });
    return true;
  };
  const event = guard((name, input = {}, onceKey = '') => {
    if (!initialize()) return false;
    if (!EVENTS.has(name) || (onceKey && state.seen.has(onceKey))) return false;
    const payload = cleanEcommerce(input);
    if (name === 'add_payment_info' && ['pesapal', 'paypal', 'dpo'].includes(input.payment_type)) {
      payload.payment_type = input.payment_type;
    }
    for (const [key, allowed] of Object.entries({ failure_stage: ['payment_initiation', 'payment_verification', 'supplier_confirmation'],
      provider: ['pesapal', 'paypal', 'dpo'], error_category: ['request_failed', 'payment_failed', 'supplier_failed'], link_location: LINK_LOCATIONS,
      form_name: ['contact'] })) {
      if (allowed.includes(input[key])) payload[key] = input[key];
    }
    if (!send(name, payload)) return false;
    if (onceKey) state.seen.add(onceKey);
    return true;
  });
  const page = guard((key) => {
    if (state.page === key || !send('page_view', {})) return false;
    state.page = key; return true;
  });
  const purchase = async (input, userData = null) => {
    try {
      if (!input || !initialize()) return false;
      const payload = cleanEcommerce(input), id = text(input.transaction_id);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !payload.currency || !(payload.value > 0) || !payload.items?.length) return false;
      const w = browser(), key = `zts:purchase:${config.measurementId}:${id}`;
      const emit = () => {
        if (state.purchases.has(id) || w.localStorage.getItem(key)) return false;
        // Fail closed if durable storage is unavailable. GA transaction_id also deduplicates receipts.
        w.localStorage.setItem(key, 'sent'); state.purchases.add(id);
        // Enhanced conversions: details the guest typed at checkout (kept for this tab only, with ad_user_data consent).
        try { setUserData(userData || savedUserData() || {}); } catch { /* booking continues */ }
        try {
          if (!send('purchase', { ...payload, transaction_id: id })) throw new Error('Analytics unavailable');
        } catch {
          w.localStorage.removeItem(key); state.purchases.delete(id); return false;
        }
        if (config.directAds && /^AW-\d+$/.test(config.adsId || '') && /^[A-Za-z0-9_-]+$/.test(config.adsLabel || '') &&
            state.consent.ad_storage === 'granted' && state.consent.ad_user_data === 'granted') {
          try { w.gtag('event', 'conversion', { ...locationData(), send_to: `${config.adsId}/${config.adsLabel}`,
            transaction_id: id, value: payload.value, currency: payload.currency }); } catch { /* booking continues */ }
        }
        forgetUserData();
        return true;
      };
      return w.navigator?.locks ? await w.navigator.locks.request(key, emit) : emit();
    } catch { return false; }
  };
  // Checkout: remember the guest's email / phone for the purchase page after the payment provider (same tab only).
  const rememberUserData = guard((input = {}) => {
    if (state.consent.ad_user_data !== 'granted') return false;
    const data = cleanUserData(input);
    if (!data.email && !data.phone_number) return false;
    storage()?.setItem(USER_DATA_KEY, JSON.stringify({ at: Date.now(), data }));
    return true;
  });
  // Contact form: call only after the server accepted the message, never for robots (honeypot). Nothing is sent
  // without consent: GA4 generate_lead needs Analytics consent, the Ads conversion advertising consent.
  // submissionId keeps a re-render or a second call from counting the same message twice.
  const lead = guard((submissionId, input = {}) => {
    const id = text(submissionId);
    if (!id || state.leads.has(id)) return false;
    const value = { value: 1.0, currency: 'USD' };
    const contactLabel = label(config.contactLabel);
    const toAds = adsAllowed() && Boolean(contactLabel);
    if (toAds) setUserData(input);
    const toAnalytics = event('generate_lead', { form_name: 'contact', ...value });
    if (toAds) browser().gtag('event', 'conversion', { ...locationData(), send_to: `${config.adsId}/${contactLabel}`, ...value });
    if (!toAds && !toAnalytics) return false;
    state.leads.add(id);
    return true;
  });
  // WhatsApp / phone / email link clicks: GA4 event (Analytics consent), plus a Google Ads conversion when that
  // label is configured and advertising consent is granted.
  const contactClick = guard((name, location) => {
    if (!['whatsapp_click', 'phone_click', 'email_click'].includes(name)) return false;
    const toAnalytics = event(name, { link_location: location });
    const clickLabel = label(name === 'whatsapp_click' ? config.whatsappLabel : name === 'phone_click' ? config.phoneLabel : '');
    const toAds = Boolean(clickLabel) && adsAllowed();
    if (toAds) browser().gtag('event', 'conversion', { ...locationData(), send_to: `${config.adsId}/${clickLabel}` });
    return toAnalytics || toAds;
  });
  const suspend = guard(() => { if (browser()) browser()[`ga-disable-${config.measurementId}`] = true; });
  return { initialize, consent, event, page, purchase, suspend, lead, contactClick, rememberUserData };
};

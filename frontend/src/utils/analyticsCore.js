const DENIED = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
const EVENTS = new Set(['view_item', 'select_item', 'begin_checkout', 'booking_form_started', 'booking_form_submitted',
  'booking_processing', 'booking_failed', 'booking_cancelled', 'whatsapp_click', 'phone_click', 'email_click']);
const text = (v) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 150) : '';
const money = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const safePath = (path = '/') => {
  if (/^\/(admin|agent|login|forgot-password|reset-password|invoice)(\/|$|-)/.test(path)) return null;
  if (/^\/(my-booking|booking-confirmation|payment-status)(\/|$)/.test(path)) return `/${path.split('/')[1]}`;
  if (path.startsWith('/payment/checkout/')) return '/payment/checkout';
  if (/^\/payment-(success|failure|processing)$/.test(path)) return path;
  if (['/', '/tours', '/privacy', '/terms'].includes(path) || /^\/(tours|booking)\/[a-z0-9-]+$/.test(path)) return path;
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
  const state = { initialized: false, consent: { ...DENIED }, page: '', seen: new Set(), purchases: new Set() };
  const guard = (fn) => (...args) => { try { return fn(...args); } catch { return false; } };
  const prepareConsent = () => {
    const w = browser();
    if (!w) return;
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    if (!w.__riserConsentDefaultsInitialized) {
      w.gtag('consent', 'default', { ...DENIED });
      w.__riserConsentDefaultsInitialized = true;
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
  const initialize = guard(() => {
    const w = browser();
    prepareConsent();
    if (!eligible() || state.consent.analytics_storage !== 'granted') {
      if (w) w[`ga-disable-${config.measurementId}`] = true;
      return false;
    }
    w[`ga-disable-${config.measurementId}`] = false;
    const route = `${w.history?.state?.key}:${w.location.pathname}`;
    if (state.route !== route) { state.route = route; state.seen.clear(); }
    if (state.initialized || w.__riserAnalyticsInitialized) { state.initialized = true; return true; }
    w.gtag('consent', 'update', { ...state.consent });
    w.gtag('set', 'ads_data_redaction', true);
    w.gtag('js', new Date());
    w.gtag('config', config.measurementId, { send_page_view: false, ...locationData(), allow_google_signals: false });
    if (config.directAds && /^AW-\d+$/.test(config.adsId || '') && /^[A-Za-z0-9_-]+$/.test(config.adsLabel || '')) {
      w.gtag('config', config.adsId, { send_page_view: false, ...locationData() });
    }
    if (!w.document.querySelector('script[data-riser-google-tag]')) {
      const script = w.document.createElement('script');
      script.async = true; script.dataset.riserGoogleTag = 'true';
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`;
      w.document.head.appendChild(script);
    }
    state.initialized = w.__riserAnalyticsInitialized = true;
    return true;
  });
  const consent = guard((choices = {}) => {
    prepareConsent();
    for (const key of Object.keys(DENIED)) state.consent[key] = choices[key] === 'granted' ? 'granted' : 'denied';
    browser()?.gtag('consent', 'update', { ...state.consent });
    initialize();
    browser()?.dispatchEvent(new Event('riser:analytics-consent'));
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
    for (const [key, allowed] of Object.entries({ failure_stage: ['payment_initiation', 'payment_verification', 'supplier_confirmation'],
      provider: ['pesapal', 'paypal', 'dpo'], error_category: ['request_failed', 'payment_failed', 'supplier_failed'], link_location: ['public_site'] })) {
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
  const purchase = async (input) => {
    try {
      if (!input || !initialize()) return false;
      const payload = cleanEcommerce(input), id = text(input.transaction_id);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !payload.currency || !(payload.value > 0) || !payload.items?.length) return false;
      const w = browser(), key = `riser:purchase:${config.measurementId}:${id}`;
      const emit = () => {
        if (state.purchases.has(id) || w.localStorage.getItem(key)) return false;
        // Fail closed if durable storage is unavailable. GA transaction_id also deduplicates receipts.
        w.localStorage.setItem(key, 'sent'); state.purchases.add(id);
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
        return true;
      };
      return w.navigator?.locks ? await w.navigator.locks.request(key, emit) : emit();
    } catch { return false; }
  };
  const suspend = guard(() => { if (browser()) browser()[`ga-disable-${config.measurementId}`] = true; });
  return { initialize, consent, event, page, purchase, suspend };
};

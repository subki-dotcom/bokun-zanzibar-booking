export const CONSENT_KEY = 'riser_cookie_consent_v1';
export const CONSENT_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
export const consentSignals = (choice) => ({
  analytics_storage: choice?.analytics === true ? 'granted' : 'denied',
  ad_storage: choice?.advertising === true ? 'granted' : 'denied',
  ad_user_data: choice?.advertising === true ? 'granted' : 'denied',
  ad_personalization: choice?.advertising === true ? 'granted' : 'denied'
});

export const createConsentStore = ({ storage, apply, now = () => Date.now() }) => {
  let choice = null;
  let memoryOnly = false;
  const listeners = new Set();
  const valid = (value) => value?.version === 1 && typeof value.analytics === 'boolean' &&
    typeof value.advertising === 'boolean' && Number.isFinite(value.updatedAt) &&
    value.updatedAt <= now() && now() - value.updatedAt < CONSENT_LIFETIME_MS;
  const notify = () => {
    try { apply(consentSignals(choice)); } catch { /* optional tracking must never break the site */ }
    listeners.forEach((listener) => { try { listener(); } catch { /* independent subscribers */ } });
  };
  const refresh = () => {
    // A failed write must not restore an older grant over this visit's rejection.
    if (memoryOnly && valid(choice)) { notify(); return choice; }
    memoryOnly = false;
    try {
      const saved = JSON.parse(storage().getItem(CONSENT_KEY) || 'null');
      choice = valid(saved) ? { version: 1, analytics: saved.analytics, advertising: saved.advertising, updatedAt: saved.updatedAt } : null;
    } catch { if (!valid(choice)) choice = null; }
    notify();
    return choice;
  };
  const save = ({ analytics = false, advertising = false } = {}) => {
    choice = { version: 1, analytics: analytics === true, advertising: advertising === true, updatedAt: now() };
    let persisted = false;
    try { storage().setItem(CONSENT_KEY, JSON.stringify(choice)); persisted = true; } catch { /* keep this visit's real choice */ }
    memoryOnly = !persisted;
    notify();
    return persisted;
  };
  return { get: () => choice, refresh, save, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
};

// Only known optional Google cookies accessible to this origin; never auth or booking storage.
export const clearOptionalCookies = (document, hostname, signals) => {
  try {
    const names = document.cookie.split(';').map((part) => part.trim().split('=')[0]);
    const domains = ['', hostname, hostname.replace(/^www\./, '')];
    for (const name of names) {
      const analyticsCookie = /^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(name);
      const adsCookie = /^(_gcl_|_gac_|__gads$|__gpi$)/.test(name);
      if (!(analyticsCookie && signals.analytics_storage === 'denied') && !(adsCookie && signals.ad_storage === 'denied')) continue;
      for (const domain of new Set(domains)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
    }
  } catch { /* browser cookie restrictions do not affect booking */ }
};

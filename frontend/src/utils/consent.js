import { updateAnalyticsConsent } from './analytics';
import { CONSENT_KEY, clearOptionalCookies, createConsentStore } from './consentStore';

export const cookieConsent = createConsentStore({
  storage: () => window.localStorage,
  apply: (signals) => {
    updateAnalyticsConsent(signals);
    if (typeof window !== 'undefined') clearOptionalCookies(document, window.location.hostname, signals);
  }
});

let initialized = false;
export const initializeConsent = () => {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  cookieConsent.refresh();
  window.addEventListener('storage', (event) => {
    if (event.key === CONSENT_KEY || event.key === null) cookieConsent.refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cookieConsent.refresh();
  });
};

export const openCookiePreferences = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('riser:open-cookie-preferences'));
};

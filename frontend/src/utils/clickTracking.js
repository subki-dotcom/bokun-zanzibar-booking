import { trackContactClick } from './analytics';
import { clickLocation, kindOf } from './clickLocation';

// One document-level listener for every WhatsApp, phone and email link on the site, so new buttons are covered
// automatically. It only reports the click: it never prevents or delays WhatsApp or the phone dialer opening.
let installed = false;
export const installClickTracking = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  // Capture phase: runs even if a component stops the click from bubbling. Passive: never blocks navigation.
  document.addEventListener('click', (event) => {
    try {
      const anchor = event.target?.closest?.('a[href]');
      const kind = anchor ? kindOf(anchor.href) : '';
      if (kind) trackContactClick(kind, clickLocation(anchor, window.location.pathname));
    } catch { /* analytics never breaks a link */ }
  }, { capture: true, passive: true });
};

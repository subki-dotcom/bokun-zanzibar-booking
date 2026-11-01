// Which kind of contact link was clicked, and where it sits on the page (one of LINK_LOCATIONS in analyticsCore).
// A link can name its own place with data-track-location="…".
export const kindOf = (href) => {
  try {
    const url = new URL(href);
    if (url.protocol === 'tel:') return 'phone_click';
    if (url.protocol === 'mailto:') return 'email_click';
    if (url.protocol === 'whatsapp:' || ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com'].includes(url.hostname)) return 'whatsapp_click';
  } catch { /* not a URL */ }
  return '';
};

export const clickLocation = (anchor, pathname = '/') => {
  const named = anchor.closest('[data-track-location]')?.getAttribute('data-track-location');
  if (named) return named;
  if (anchor.matches('.floating-whatsapp-btn, .hp-fab')) return 'floating_button';
  if (anchor.closest('.sh-menu')) return 'mobile_menu';
  if (anchor.closest('.sh-search')) return 'search_panel';
  if (anchor.closest('[class*="sh-mega"]')) return 'mega_menu';
  if (anchor.closest('header[role="banner"]')) return 'header';
  if (anchor.closest('footer[role="contentinfo"]')) return 'footer';
  if (pathname === '/contact') return anchor.closest('.cp-card-form') ? 'contact_form_result' : 'contact_page';
  if (pathname === '/') return anchor.closest('.hp-hero') ? 'home_hero' : 'page';
  if (pathname === '/tours') return 'tours_page';
  if (pathname.startsWith('/tours/')) return 'tour_page';
  if (pathname.startsWith('/booking/confirmed')) return 'booking_confirmed';
  if (pathname.startsWith('/booking/')) return 'checkout';
  if (pathname.startsWith('/payment')) return 'payment';
  if (pathname === '/my-booking') return 'booking_lookup';
  if (pathname.startsWith('/my-booking')) return 'my_booking';
  return 'page';
};

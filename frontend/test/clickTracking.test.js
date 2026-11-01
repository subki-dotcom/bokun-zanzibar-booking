import test from 'node:test';
import assert from 'node:assert/strict';
import { clickLocation, kindOf } from '../src/utils/clickLocation.js';

// A tiny stand-in for an <a> element: `inside` lists the selectors of its ancestors, `self` its own.
const link = (inside = [], self = [], named = '') => ({
  closest: (sel) => (sel === '[data-track-location]' ? (named ? { getAttribute: () => named } : null)
    : sel.split(',').map((x) => x.trim()).some((x) => inside.includes(x) || self.includes(x)) ? {} : null),
  matches: (sel) => sel.split(',').map((x) => x.trim()).some((x) => self.includes(x))
});

test('WhatsApp, phone and email links are recognised; other links are not', () => {
  assert.equal(kindOf('https://wa.me/255777000000?text=hi'), 'whatsapp_click');
  assert.equal(kindOf('https://api.whatsapp.com/send?phone=255777000000'), 'whatsapp_click');
  assert.equal(kindOf('tel:+255777000000'), 'phone_click');
  assert.equal(kindOf('mailto:info@example.com'), 'email_click');
  assert.equal(kindOf('https://zanzibartoursandsafaris.co.tz/tours'), '');
  assert.equal(kindOf('not a url'), '');
});

test('link_location follows where the link sits on the page', () => {
  assert.equal(clickLocation(link([], ['.floating-whatsapp-btn']), '/tours'), 'floating_button');
  assert.equal(clickLocation(link(['.sh-menu', 'header[role="banner"]']), '/'), 'mobile_menu');
  assert.equal(clickLocation(link(['header[role="banner"]']), '/tours'), 'header');
  assert.equal(clickLocation(link(['footer[role="contentinfo"]']), '/contact'), 'footer');
  assert.equal(clickLocation(link(['.cp-card-form']), '/contact'), 'contact_form_result');
  assert.equal(clickLocation(link([]), '/contact'), 'contact_page');
  assert.equal(clickLocation(link(['.hp-hero']), '/'), 'home_hero');
  assert.equal(clickLocation(link([]), '/tours/spice-tour'), 'tour_page');
  assert.equal(clickLocation(link([], [], 'checkout'), '/'), 'checkout');
});

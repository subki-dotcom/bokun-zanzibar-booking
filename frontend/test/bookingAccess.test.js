import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom, access;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://zanzibartoursandsafaris.co.tz/' });
  globalThis.window = dom.window;
  access = await import('../../shared/src/api/bookingAccess.js');
});
beforeEach(() => {
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  dom.window.history.replaceState(null, '', '/');
});
after(() => { dom.window.close(); delete globalThis.window; });

const future = () => new Date(Date.now() + 86400000).toISOString();
const address = () => dom.window.location.pathname + dom.window.location.search + dom.window.location.hash;

test('emailed #access links are stored per booking and removed from the address bar before the app runs', () => {
  dom.window.history.replaceState({ key: 'router' }, '', '/my-booking/ZNZ-1-1?utm_source=mail#access=tok.abc');
  access.captureBookingAccessFromLocation();
  assert.equal(address(), '/my-booking/ZNZ-1-1?utm_source=mail');
  assert.deepEqual(dom.window.history.state, { key: 'router' }, 'router state is preserved');
  assert.deepEqual(access.bookingAccessHeaders('znz-1-1 '), { 'X-Booking-Access-Token': 'tok.abc' });
  assert.deepEqual(access.bookingAccessHeaders('ZNZ-2-2'), {}, 'a token never applies to another booking');
});

test('legacy ?access= links are captured and stripped too; other fragments survive', () => {
  dom.window.history.replaceState(null, '', '/invoice/ZNZ-7-7?access=tok.legacy#section');
  access.captureBookingAccessFromLocation();
  assert.equal(address(), '/invoice/ZNZ-7-7#section');
  assert.equal(access.getBookingAccessToken('ZNZ-7-7'), 'tok.legacy');
});

test('#verify links become a one-time pending verification for that booking only', () => {
  dom.window.history.replaceState(null, '', `/my-booking/ZNZ-3-3#verify=${'a'.repeat(64)}`);
  access.captureBookingAccessFromLocation();
  assert.equal(address(), '/my-booking/ZNZ-3-3');
  assert.equal(dom.window.localStorage.getItem('riser_booking_access'), null, 'a verification is not an access token');
  assert.equal(access.takePendingVerification('ZNZ-9-9'), '');
  assert.equal(access.takePendingVerification('znz-3-3'), 'a'.repeat(64));
  assert.equal(access.takePendingVerification('ZNZ-3-3'), '', 'handed out once');
  access.markVerificationFailed('ZNZ-3-3');
  assert.equal(access.takeVerificationFailure('ZNZ-4-4'), false);
  assert.equal(access.takeVerificationFailure('ZNZ-3-3'), true);
  assert.equal(access.takeVerificationFailure('ZNZ-3-3'), false);
});

test('credentials on unrelated pages are removed but never stored', () => {
  dom.window.history.replaceState(null, '', '/tours#access=tok.x&verify=abc');
  access.captureBookingAccessFromLocation();
  assert.equal(address(), '/tours');
  assert.equal(dom.window.localStorage.getItem('riser_booking_access'), null);
  assert.equal(dom.window.sessionStorage.getItem('riser_booking_verify'), null);
});

test('checkout responses keep the new booking token; expired and forgotten tokens are not sent', () => {
  const result = { bookingReference: 'ZNZ-3-3', bookingAccessToken: 'tok.new', bookingAccessExpiresAt: future(), redirectUrl: 'https://pay.invalid' };
  assert.equal(access.rememberCheckoutAccess(result), result);
  assert.equal(access.getBookingAccessToken('ZNZ-3-3'), 'tok.new');
  access.rememberBookingAccess('ZNZ-4-4', 'tok.old', new Date(Date.now() - 1000).toISOString());
  assert.equal(access.getBookingAccessToken('ZNZ-4-4'), '');
  access.forgetBookingAccess('ZNZ-3-3');
  assert.equal(access.getBookingAccessToken('ZNZ-3-3'), '');
  access.rememberCheckoutAccess({ bookingReference: 'ZNZ-5-5' });
  assert.equal(access.getBookingAccessToken('ZNZ-5-5'), '');
});

test('storage stays bounded and tolerates corrupt or unavailable storage', () => {
  for (let index = 0; index < 30; index += 1) access.rememberBookingAccess(`ZNZ-${index}-1`, `tok.${index}`, future());
  assert.ok(Object.keys(JSON.parse(dom.window.localStorage.getItem('riser_booking_access'))).length <= 20);
  dom.window.localStorage.setItem('riser_booking_access', '{not json');
  assert.equal(access.getBookingAccessToken('ZNZ-1-1'), '');
  const original = Object.getOwnPropertyDescriptor(dom.window, 'localStorage');
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
  try {
    assert.doesNotThrow(() => access.rememberBookingAccess('ZNZ-9-9', 'tok.x'));
    assert.deepEqual(access.bookingAccessHeaders('ZNZ-9-9'), {});
  } finally {
    Object.defineProperty(dom.window, 'localStorage', original);
  }
});

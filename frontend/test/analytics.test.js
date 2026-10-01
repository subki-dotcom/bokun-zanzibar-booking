import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, safePath } from '../src/utils/analyticsCore.js';
const granted = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
const receipt = { transaction_id: 'RB-123', currency: 'TZS', value: 250000,
  items: [{ item_id: '42', item_name: 'Spice tour', price: 250000, quantity: 1 }] };
function setup(extra = {}) {
  const store = new Map(), scripts = [], events = [];
  const w = { location: { hostname: 'zanzibartoursandsafaris.co.tz', origin: 'https://zanzibartoursandsafaris.co.tz', pathname: '/', search: '' },
    localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
    document: { title: 'Zanzibar Tours', referrer: 'https://google.com/search?q=private', querySelector: () => scripts[0],
      createElement: () => ({ dataset: {} }), head: { appendChild: s => scripts.push(s) } }, dispatchEvent: () => {},
    gtag: (...args) => events.push(args) };
  const config = { production: true, measurementId: 'G-G4HFYGCFLH', ...extra };
  const api = createAnalytics(config, () => w);
  return { api, w, scripts, events, store, config };
}
const sent = (events, name) => events.filter(e => e[0] === 'event' && e[1] === name);
test('consent defaults block scripts; grant initializes once and SPA views deduplicate', () => {
  const { api, scripts, events } = setup();
  assert.equal(api.page('a'), false); assert.equal(scripts.length, 0);
  api.consent(granted); api.initialize(); api.initialize();
  assert.equal(scripts.length, 1);
  assert.equal(events.filter(e => e[0] === 'config').length, 1);
  assert.equal(events.find(e => e[0] === 'config')[2].send_page_view, false);
  api.page('a'); api.page('a'); api.page('b'); api.page('a');
  assert.equal(sent(events, 'page_view').length, 3);
  api.consent({}); api.page('c'); assert.equal(sent(events, 'page_view').length, 3);
});
test('purchase requires a valid backend projection and is durable across refresh/reopen', async () => {
  const { api, w, config, events } = setup(); api.consent(granted);
  assert.equal(await api.purchase(null), false);
  assert.equal(await api.purchase({ status: 'success' }), false);
  assert.equal(api.event('purchase', receipt), false);
  assert.equal(await api.purchase(receipt), true);
  assert.equal(await api.purchase(receipt), false);
  const refreshed = createAnalytics(config, () => w); refreshed.consent(granted);
  assert.equal(await refreshed.purchase(receipt), false);
  assert.equal(sent(events, 'purchase').length, 1);
    assert.equal(sent(events, 'purchase')[0][2].transaction_id, 'RB-123');
    assert.equal(sent(events, 'purchase')[0][2].value, 250000);
  assert.equal(sent(events, 'purchase')[0][2].currency, 'TZS');
});
test('PII, payment query tokens, private references and raw failures are discarded', async () => {
  const { api, w, events } = setup();
  w.location.pathname='/payment-status/PRIVATE-BOOKING'; w.location.search='?email=secret@example.com&token=secret';
  api.consent(granted); api.page('a');
  api.event('booking_failed', { email: 'secret@example.com', error: 'private stack', failure_stage: 'payment_verification' });
  await api.purchase({ ...receipt, customer: { email: 'secret@example.com' }, items: [{...receipt.items[0], passport:'private passport'}] });
  const output = JSON.stringify(events);
  for (const privateText of ['secret@example', 'PRIVATE-BOOKING', 'private stack', 'private passport', '?token']) assert.ok(!output.includes(privateText));
  assert.equal(safePath('/reset-password'), null);
});
test('configuration, localhost, internal sessions and blocked storage fail safely', async () => {
  for (const mutate of [s => {s.w.location.hostname='localhost';}, s => s.store.set('zanzibar_auth_token','internal'), s => {s.w.localStorage.getItem=()=>{throw Error('blocked');};}]) {
    const s=setup(); mutate(s); s.api.consent(granted);
    assert.equal(s.api.page('a'),false); assert.equal(await s.api.purchase(receipt),false); assert.equal(s.scripts.length,0);
  }
  const missing=setup({measurementId:''}); missing.api.consent(granted); assert.equal(missing.scripts.length,0);
  const blocked=setup(); blocked.api.consent(granted); blocked.w.gtag=()=>{throw Error('blocked');};
  assert.equal(await blocked.api.purchase(receipt),false); assert.equal(blocked.api.event('begin_checkout'),false);
});
test('Ads is optional, uses the same receipt only, and respects advertising consent', async () => {
  const noAds=setup(); noAds.api.consent(granted); await noAds.api.purchase(receipt); assert.equal(sent(noAds.events,'conversion').length,0);
  const ads=setup({directAds:true,adsId:'AW-123456',adsLabel:'realLabel'}); ads.api.consent(granted);
  ads.api.event('booking_form_submitted'); assert.equal(sent(ads.events,'conversion').length,0);
  await ads.api.purchase(receipt); await ads.api.purchase(receipt);
  assert.equal(sent(ads.events,'conversion').length,1);
  assert.equal(sent(ads.events,'conversion')[0][2].transaction_id,receipt.transaction_id);
  const denied=setup({directAds:true,adsId:'AW-123456',adsLabel:'realLabel'}); denied.api.consent({analytics_storage:'granted'});
  await denied.api.purchase(receipt); assert.equal(sent(denied.events,'conversion').length,0);
});
test('safe attribution retained without forwarding arbitrary queries', () => {
  const { api,w,events }=setup(); w.location.search='?gclid=opaque123&utm_source=google&utm_medium=cpc&email=secret';
  api.consent(granted); api.page('a'); const url=sent(events,'page_view')[0][2].page_location;
  assert.match(url,/gclid=opaque123/); assert.match(url,/utm_source=google/); assert.ok(!url.includes('email'));
});
test('ecommerce rerenders do not repeat views and a new visit can record another view', () => {
  const s=setup(); s.api.consent(granted);
  s.api.event('view_item',receipt,'view:tour'); s.api.event('view_item',receipt,'view:tour');
  assert.equal(sent(s.events,'view_item').length,1);
  s.w.location.pathname='/tours'; s.api.page('next');
  s.w.location.pathname='/'; s.api.event('view_item',receipt,'view:tour');
  assert.equal(sent(s.events,'view_item').length,2);
});
test('concurrent purchases across tabs use the browser lock and shared durable receipt', async () => {
  const s=setup(); let queue=Promise.resolve();
  s.w.navigator={locks:{request: (_key, callback) => { const task=queue.then(callback); queue=task.catch(()=>{}); return task; }}};
  const tab2=createAnalytics(s.config,()=>s.w); s.api.consent(granted); tab2.consent(granted);
  const results=await Promise.all([s.api.purchase(receipt),tab2.purchase(receipt)]);
  assert.equal(results.filter(Boolean).length,1); assert.equal(sent(s.events,'purchase').length,1);
});

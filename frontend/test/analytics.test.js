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
    document: { title: 'Zanzibar Tours', referrer: 'https://google.com/search?q=private', querySelector: () => scripts.find(script => script.dataset.ztsGoogleTag),
      createElement: () => ({ dataset: {} }), head: { appendChild: s => scripts.push(s) } }, dispatchEvent: () => {},
    gtag: (...args) => events.push(args) };
  const config = { production: true, measurementId: 'G-G4HFYGCFLH', ...extra };
  const api = createAnalytics(config, () => w);
  return { api, w, scripts, events, store, config };
}
const sent = (events, name) => events.filter(e => e[0] === 'event' && e[1] === name);
test('GTM loads once after analytics consent on eligible public pages without extra GA events', () => {
  const s = setup({ gtmId: 'GTM-PF7LKQ72' });
  s.api.initialize();
  assert.equal(s.scripts.filter(script => script.src.includes('/gtm.js')).length, 0);
  s.api.consent(granted);
  s.api.initialize();
  s.w.location.pathname = '/tours';
  s.api.page('tours');
  s.api.consent(granted);
  assert.equal(s.scripts.filter(script => script.src === 'https://www.googletagmanager.com/gtm.js?id=GTM-PF7LKQ72').length, 1);
  assert.equal(s.w.dataLayer.filter(event => event.event === 'gtm.js').length, 1);
  assert.equal(s.events.filter(event => event[0] === 'config').length, 1);
  assert.equal(sent(s.events, 'page_view').length, 1);
  const returning = setup({ gtmId: 'GTM-PF7LKQ72' });
  returning.api.consent(granted);
  assert.equal(returning.scripts.filter(script => script.src.includes('/gtag/js')).length, 1);
  assert.equal(returning.scripts.filter(script => script.src.includes('/gtm.js')).length, 1);
  s.api.consent({});
  assert.equal(s.api.page('denied'), false);
  for (const mutate of [s => { s.w.location.pathname = '/admin'; }, s => { s.w.location.hostname = 'localhost'; }, s => s.store.set('zanzibar_auth_token', 'internal')]) {
    const excluded = setup({ gtmId: 'GTM-PF7LKQ72' }); mutate(excluded); excluded.api.consent(granted);
    assert.equal(excluded.scripts.length, 0);
  }
});
test('confirmed booking permits a consented purchase without exposing its URL reference', async () => {
  const s = setup();
  s.w.location.pathname = '/booking/confirmed/PRIVATE-REFERENCE';
  s.w.location.search = '?token=PRIVATE-TOKEN';
  assert.equal(await s.api.purchase(receipt), false);
  s.api.consent(granted);
  assert.equal(s.api.page('confirmed'), true);
  assert.equal(await s.api.purchase(receipt), true);
  assert.equal(await s.api.purchase(receipt), false);
  assert.equal(sent(s.events, 'purchase').length, 1);
  assert.equal(sent(s.events, 'purchase')[0][2].page_path, '/booking/confirmed');
  assert.doesNotMatch(JSON.stringify(s.events), /PRIVATE-REFERENCE|PRIVATE-TOKEN/);
});
test('public informational pages record visits and contact clicks', () => {
  const s = setup(); s.api.consent(granted);
  for (const path of ['/about', '/contact', '/faq', '/cancellation-policy']) {
    s.w.location.pathname = path;
    assert.equal(s.api.page(path), true);
    assert.equal(sent(s.events, 'page_view').at(-1)[2].page_path, path);
  }
  assert.equal(s.api.event('phone_click', { link_location: 'public_site' }), true);
  for (const path of ['/admin', '/agent', '/invoice/PRIVATE', '/unknown']) assert.equal(safePath(path), null);
});
test('payment types retain supported providers and discard arbitrary input', () => {
  const s = setup(); s.api.consent(granted);
  for (const payment_type of ['pesapal', 'paypal', 'dpo']) {
    s.api.event('add_payment_info', { ...receipt, payment_type });
    assert.equal(sent(s.events, 'add_payment_info').at(-1)[2].payment_type, payment_type);
  }
  s.api.event('add_payment_info', { ...receipt, payment_type: 'private@example.com' });
  assert.equal(sent(s.events, 'add_payment_info').at(-1)[2].payment_type, undefined);
  s.api.consent({});
  assert.equal(s.api.event('add_payment_info', { ...receipt, payment_type: 'paypal' }), false);
});
test('public navigation resumes Google collection after tracker cleanup', async () => {
  const { api, w, config, events, scripts, store } = setup();
  const disabled = `ga-disable-${config.measurementId}`;
  api.consent(granted);
  api.page('home');
  api.suspend();
  assert.equal(w[disabled], true);
  w.location.pathname = '/tours';
  assert.equal(api.page('tours'), true);
  assert.equal(w[disabled], false);
  assert.equal(sent(events, 'page_view').length, 2);
  assert.equal(scripts.length, 1);
  assert.equal(await api.purchase(receipt), true);
  assert.equal(w[disabled], false);

  api.suspend();
  w.location.pathname = '/admin';
  assert.equal(api.page('admin'), false);
  assert.equal(w[disabled], true);
  w.location.pathname = '/tours';
  store.set('zanzibar_auth_token', 'internal');
  assert.equal(api.page('internal'), false);
  assert.equal(w[disabled], true);
  store.delete('zanzibar_auth_token');
  api.consent({});
  assert.equal(api.page('denied'), false);
  assert.equal(api.event('begin_checkout'), false);
  assert.equal(sent(events, 'page_view').length, 2);
  api.consent(granted);
  assert.equal(api.page('return'), true);
  assert.equal(w[disabled], false);
});
test('denied consent loads the detectable Google tag but blocks events until grant', async () => {
  const { api, scripts, events } = setup();
  assert.equal(api.page('a'), false);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /gtag\/js\?id=G-G4HFYGCFLH/);
  assert.equal(events.filter(e => e[0] === 'config').length, 1);
  assert.equal(events.find(e => e[0] === 'config')[2].send_page_view, false);
  assert.equal(sent(events, 'page_view').length, 0);
  assert.equal(await api.purchase(receipt), false);
  assert.equal(sent(events, 'purchase').length, 0);
  api.consent(granted); api.initialize(); api.initialize();
  assert.equal(scripts.length, 1);
  assert.equal(events.filter(e => e[0] === 'config').length, 1);
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

test('booking funnel events are sent with consent, add_payment_info included', () => {
  const s = setup(); s.w.location.pathname = '/tours/spice';
  for (const name of ['select_date', 'check_availability', 'select_option', 'add_shipping_info', 'add_payment_info']) {
    assert.equal(s.api.event(name, receipt), false, name + ' waits for consent');
  }
  s.api.consent(granted);
  for (const name of ['select_date', 'check_availability', 'select_option', 'add_shipping_info', 'add_payment_info']) {
    assert.equal(s.api.event(name, { ...receipt, number_of_guests: 2 }), true, name);
    assert.equal(sent(s.events, name).length, 1, name);
    assert.equal(sent(s.events, name)[0][2].number_of_guests, 2);
  }
  assert.equal(s.api.event('made_up_event', receipt), false, 'unknown events are still dropped');
});
test('the Google Ads tag is configured only after advertising consent, once, without a conversion label', () => {
  const adsConfig = (events) => events.filter(e => e[0] === 'config' && e[1] === 'AW-18541089433');
  const page = setup({ adsId: 'AW-18541089433' });
  page.api.consent({ analytics_storage: 'granted' });
  assert.equal(adsConfig(page.events).length, 0);
  page.api.consent(granted);
  page.api.consent(granted);
  assert.equal(adsConfig(page.events).length, 1);
  assert.equal(adsConfig(page.events)[0][2].send_page_view, false);
  assert.equal(adsConfig(page.events)[0][2].allow_enhanced_conversions, true);
  const none = setup({ adsId: 'not-an-ads-id' });
  none.api.consent(granted);
  assert.equal(none.events.filter(e => e[0] === 'config' && /^AW-/.test(String(e[1]))).length, 0);
});

const contactConfig = { adsId: 'AW-18541089433', contactLabel: 'tMbNCIOd-a8dEJmliolF' };
const conversions = (events, sendTo) => sent(events, 'conversion').filter(e => e[2].send_to === sendTo);
const userDataSets = (events) => events.filter(e => e[0] === 'set' && e[1] === 'user_data');
test('contact lead: Ads conversion and generate_lead once per submission, with consented user_data', () => {
  const s = setup(contactConfig); s.w.location.pathname = '/contact'; s.api.consent(granted);
  assert.equal(s.api.lead('contact:1', { email: '  Guest@Example.COM ', phone_number: '+447700900123' }), true);
  assert.equal(s.api.lead('contact:1', { email: 'guest@example.com' }), false, 'no double fire');
  const conv = conversions(s.events, 'AW-18541089433/tMbNCIOd-a8dEJmliolF');
  assert.equal(conv.length, 1);
  assert.equal(conv[0][2].value, 1); assert.equal(conv[0][2].currency, 'USD');
  const lead = sent(s.events, 'generate_lead');
  assert.equal(lead.length, 1); assert.equal(lead[0][2].form_name, 'contact'); assert.equal(lead[0][2].value, 1);
  const setIndex = s.events.findIndex(e => e[0] === 'set' && e[1] === 'user_data');
  assert.deepEqual(s.events[setIndex][2], { email: 'guest@example.com', phone_number: '+447700900123' });
  assert.ok(setIndex < s.events.indexOf(conv[0]), 'user_data is set before the conversion');
  assert.equal(s.api.lead('contact:2', { email: 'other@example.com', phone_number: '07700 900123' }), true);
  assert.deepEqual(userDataSets(s.events).at(-1)[2], { email: 'other@example.com' }, 'invalid phone is left out');
});
test('contact lead respects consent: nothing before a choice, GA4 only with Analytics-only consent', () => {
  const none = setup(contactConfig); none.w.location.pathname = '/contact';
  assert.equal(none.api.lead('contact:1', { email: 'guest@example.com' }), false);
  assert.equal(none.events.filter(e => e[0] === 'event').length, 0, 'no pings without consent');
  assert.equal(userDataSets(none.events).length, 0);
  const analyticsOnly = setup(contactConfig); analyticsOnly.w.location.pathname = '/contact';
  analyticsOnly.api.consent({ analytics_storage: 'granted' });
  assert.equal(analyticsOnly.api.lead('contact:1', { email: 'guest@example.com' }), true);
  assert.equal(sent(analyticsOnly.events, 'generate_lead').length, 1);
  assert.equal(sent(analyticsOnly.events, 'conversion').length, 0);
  assert.equal(userDataSets(analyticsOnly.events).length, 0);
  const adsOnly = setup(contactConfig); adsOnly.w.location.pathname = '/contact';
  adsOnly.api.consent({ ad_storage: 'granted' });
  assert.equal(adsOnly.api.lead('contact:1', { email: 'guest@example.com' }), true);
  assert.equal(sent(adsOnly.events, 'generate_lead').length, 0);
  assert.equal(sent(adsOnly.events, 'conversion').length, 1);
  assert.equal(userDataSets(adsOnly.events).length, 0, 'user_data needs ad_user_data');
  const local = setup(contactConfig); local.w.location.hostname = 'localhost'; local.api.consent(granted);
  assert.equal(local.api.lead('contact:1', { email: 'guest@example.com' }), false);
  assert.equal(sent(local.events, 'conversion').length, 0);
});
test('WhatsApp and phone clicks: GA4 event with location; Ads conversion only with a label and consent', () => {
  const before = setup({ adsId: 'AW-18541089433', whatsappLabel: 'waLabel' });
  assert.equal(before.api.contactClick('whatsapp_click', 'header'), false);
  assert.equal(before.events.filter(e => e[0] === 'event').length, 0, 'nothing before consent');
  const s = setup({ adsId: 'AW-18541089433' }); s.api.consent(granted);
  const toGa4 = (name) => sent(s.events, name).filter(e => e[2].send_to === 'G-G4HFYGCFLH');
  const toAds = (name) => sent(s.events, name).filter(e => e[2].send_to === 'AW-18541089433');
  assert.equal(s.api.contactClick('whatsapp_click', 'floating_button'), true);
  assert.equal(s.api.contactClick('phone_click', 'contact_page'), true);
  assert.equal(toGa4('whatsapp_click')[0][2].link_location, 'floating_button');
  assert.equal(toGa4('phone_click')[0][2].link_location, 'contact_page');
  assert.equal(sent(s.events, 'conversion').length, 0, 'no labels: no label-based Ads conversion');
  // The Google Ads event-based conversion "whatsapp_click": the same event to the Ads tag, once per click.
  assert.equal(toAds('whatsapp_click').length, 1);
  assert.equal(toAds('whatsapp_click')[0][2].link_location, 'floating_button');
  assert.equal(toAds('phone_click').length, 0);
  s.api.contactClick('whatsapp_click', 'made-up');
  assert.equal(toGa4('whatsapp_click')[1][2].link_location, undefined);
  assert.equal(toAds('whatsapp_click').length, 2);
  const analyticsOnly = setup({ adsId: 'AW-18541089433' }); analyticsOnly.api.consent({ analytics_storage: 'granted' });
  analyticsOnly.api.contactClick('whatsapp_click', 'header');
  assert.equal(sent(analyticsOnly.events, 'whatsapp_click').filter(e => e[2].send_to === 'AW-18541089433').length, 0, 'Ads needs advertising consent');
  const labelled = setup({ adsId: 'AW-18541089433', whatsappLabel: 'waLabel', phoneLabel: 'telLabel' });
  labelled.api.consent(granted);
  labelled.api.contactClick('whatsapp_click', 'header'); labelled.api.contactClick('phone_click', 'footer');
  assert.equal(conversions(labelled.events, 'AW-18541089433/waLabel').length, 1);
  assert.equal(conversions(labelled.events, 'AW-18541089433/telLabel').length, 1);
});
test('booking: checkout user data reaches the purchase only with ad_user_data consent, then is removed', async () => {
  const session = new Map();
  const s = setup({ directAds: true, adsId: 'AW-18541089433', adsLabel: 'bookLabel' });
  s.w.sessionStorage = { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) };
  assert.equal(s.api.rememberUserData({ email: 'guest@example.com' }), false, 'not without consent');
  s.api.consent(granted);
  assert.equal(s.api.rememberUserData({ email: ' Guest@Example.com', phone_number: '+255777123456' }), true);
  assert.equal(await s.api.purchase(receipt), true);
  const userData = s.events.findIndex(e => e[0] === 'set' && e[1] === 'user_data');
  assert.deepEqual(s.events[userData][2], { email: 'guest@example.com', phone_number: '+255777123456' });
  assert.ok(userData < s.events.indexOf(sent(s.events, 'conversion')[0]));
  assert.equal(session.size, 0, 'removed after the purchase');
  s.api.rememberUserData({ email: 'guest@example.com' });
  s.api.consent({ analytics_storage: 'granted' });
  assert.equal(session.size, 0, 'removed when advertising consent is withdrawn');
});

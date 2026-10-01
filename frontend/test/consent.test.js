import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsentStore, consentSignals, CONSENT_KEY, CONSENT_LIFETIME_MS, clearOptionalCookies } from '../src/utils/consentStore.js';
import { createAnalytics } from '../src/utils/analyticsCore.js';
const setup = () => {
  let time = 1800000000000;
  const data = new Map(), calls = [];
  const storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) };
  const store = createConsentStore({ storage: () => storage, apply: s => calls.push(s), now: () => time });
  return { store, data, storage, calls, advance: n => { time += n; } };
};
test('fresh, corrupt, future, expired and old-version choices default denied', () => {
  const s = setup(); s.store.refresh();
  assert.equal(s.store.get(),null); assert.ok(Object.values(s.calls.at(-1)).every(v=>v==='denied'));
  for (const saved of ['bad json', JSON.stringify({version:0,analytics:true,advertising:true,updatedAt:1800000000000}),
    JSON.stringify({version:1,analytics:true,advertising:true,updatedAt:1900000000000})]) {
    s.data.set(CONSENT_KEY,saved); s.store.refresh(); assert.equal(s.store.get(),null);
  }
  s.store.save({analytics:true,advertising:true}); s.advance(CONSENT_LIFETIME_MS); s.store.refresh();
  assert.equal(s.store.get(),null);
});
test('Accept All, Reject Optional and independent categories map four consent signals', () => {
  const s=setup();
  s.store.save({analytics:true,advertising:true}); assert.ok(Object.values(s.calls.at(-1)).every(v=>v==='granted'));
  s.store.save({analytics:false,advertising:false}); assert.ok(Object.values(s.calls.at(-1)).every(v=>v==='denied'));
  s.store.save({analytics:true,advertising:false}); assert.deepEqual(s.calls.at(-1),{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  s.store.save({analytics:false,advertising:true}); assert.deepEqual(s.calls.at(-1),{analytics_storage:'denied',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'});
});
test('choice survives reload, saves no private data, notifies changes and tolerates blocked storage', () => {
  const s=setup(); let updates=0; const unsubscribe=s.store.subscribe(()=>updates++);
  assert.equal(s.store.save({analytics:true,advertising:false,email:'private@example.com'}),true);
  assert.deepEqual(Object.keys(JSON.parse(s.data.get(CONSENT_KEY))).sort(),['advertising','analytics','updatedAt','version']);
  const fresh=createConsentStore({storage:()=>s.storage,apply:()=>{},now:()=>1800000000001}); fresh.refresh();
  assert.equal(fresh.get().analytics,true); assert.equal(fresh.get().advertising,false);
  s.storage.setItem=()=>{throw Error('blocked');};
  assert.equal(s.store.save({analytics:false,advertising:false}),false);
  assert.equal(s.store.get().analytics,false); assert.equal(updates,2); unsubscribe();
  s.store.refresh(); // visibility refresh must not resurrect the older stored grant
  assert.equal(s.store.get().analytics,false);
  assert.equal(s.calls.at(-1).analytics_storage,'denied');
});
test('consent precedes config and tag load; regrant does not initialize twice or repeat a page', () => {
  const commands=[],scripts=[],data=new Map();
  const w={location:{hostname:'zanzibartoursandsafaris.co.tz',origin:'https://zanzibartoursandsafaris.co.tz',pathname:'/',search:'?gclid=real-click'},
    localStorage:{getItem:k=>data.get(k)},document:{referrer:'',title:'Tours',querySelector:()=>scripts[0],createElement:()=>({dataset:{}}),head:{appendChild:s=>scripts.push(s)}},
    gtag:(...args)=>commands.push(args),dispatchEvent:()=>{}};
  const analytics=createAnalytics({production:true,measurementId:'G-G4HFYGCFLH'},()=>w);
  analytics.consent(consentSignals(null)); assert.equal(commands[0][0],'consent'); assert.equal(commands[0][1],'default');
  assert.equal(scripts.length,0); assert.equal(analytics.page('initial'),false);
  analytics.consent(consentSignals({analytics:true})); analytics.page('initial'); analytics.page('initial');
  analytics.page('tour'); analytics.page('initial'); analytics.page('tour'); // back, forward
  analytics.consent(consentSignals(null)); assert.equal(analytics.page('denied'),false);
  analytics.consent(consentSignals({analytics:true})); analytics.page('tour');
  assert.equal(scripts.length,1); assert.equal(commands.filter(c=>c[0]==='config').length,1);
  assert.equal(commands.filter(c=>c[0]==='event'&&c[1]==='page_view').length,4);
  assert.equal(commands.filter(c=>c[0]==='consent'&&c[1]==='default').length,1);
  assert.equal(commands[0][2].analytics_storage,'denied'); // defaults must not be mutated later
});
test('withdrawal cookie cleanup excludes necessary login and booking cookies', () => {
  const writes=[]; const doc={get cookie(){return '_ga=1; _ga_ABC=2; _gcl_aw=3; booking_session=4; auth=5';},set cookie(v){writes.push(v);}};
  clearOptionalCookies(doc,'www.zanzibartoursandsafaris.co.tz',consentSignals(null));
  assert.ok(writes.some(v=>v.startsWith('_ga='))); assert.ok(writes.some(v=>v.startsWith('_gcl_aw=')));
  assert.ok(writes.every(v=>!v.startsWith('auth=')&&!v.startsWith('booking_session=')));
});

import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { sharedResolve } from '../../shared/vite.shared.js';
import { createConsentStore } from '../src/utils/consentStore.js';
let dom, server, root, Page, Footer, Router, store, choices;
const wait = () => new Promise(resolve=>setTimeout(resolve,360));
before(async()=>{
  dom=new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>',{url:'https://zanzibartoursandsafaris.co.tz/',pretendToBeVisual:true});
  for(const name of ['window','document','HTMLElement','Node','Event','CustomEvent','MutationObserver']) globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  server=await createServer({configFile:false,resolve:sharedResolve,esbuild:{jsx:'automatic'},server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
  Page=(await server.ssrLoadModule('/src/components/common/CookieConsent.jsx')).default;
  Footer=(await server.ssrLoadModule('/src/components/common/footer/FooterBottom.jsx')).default;
  Router=(await import('react-router-dom')).MemoryRouter;
});
beforeEach(async()=>{
  choices=[]; const data=new Map();
  store=createConsentStore({storage:()=>({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}),apply:s=>choices.push(s)});
  const {createRoot}=await import('react-dom/client'); root=createRoot(document.getElementById('test-root'));
});
afterEach(async()=>{await act(async()=>{root.unmount(); await wait();});});
after(async()=>{await server?.close();dom?.window.close();});
async function mount(){await act(async()=>{root.render(React.createElement(Router,{},React.createElement(React.Fragment,{},React.createElement(Page,{store}),React.createElement(Footer))));});}
function button(label){return [...document.querySelectorAll('button')].find(el=>el.textContent===label);}
async function click(label){await act(async()=>{button(label).focus();button(label).click();});await act(wait);}
test('banner offers equal real actions; Accept All saves and dismisses; footer reopens preferences',async()=>{
  await mount(); for(const label of ['Accept All','Reject Optional','Manage Preferences']) assert.ok(button(label));
  await click('Accept All'); assert.equal(document.querySelector('.cookie-consent-banner'),null);
  assert.ok(Object.values(choices.at(-1)).every(v=>v==='granted'));
  await click('Cookie Preferences');
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.getElementById('consent-necessary').disabled,true);
  assert.equal(document.getElementById('consent-analytics').checked,true);
  assert.equal(document.getElementById('consent-advertising').checked,true);
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement));
});
test('Reject Optional persists; preferences allow analytics only and can be revoked',async()=>{
  await mount(); await click('Reject Optional'); assert.equal(store.get().analytics,false); assert.equal(store.get().advertising,false);
  await click('Cookie Preferences');
  await act(async()=>{document.getElementById('consent-analytics').click();});
  await click('Save Preferences'); assert.equal(store.get().analytics,true); assert.equal(store.get().advertising,false);
  await click('Cookie Preferences'); await click('Reject Optional');
  assert.ok(Object.values(choices.at(-1)).every(v=>v==='denied'));
});
test('saved choice suppresses banner; closing preferences does not grant consent and restores focus',async()=>{
  store.save({analytics:false,advertising:true}); await mount(); assert.equal(document.querySelector('.cookie-consent-banner'),null);
  await click('Cookie Preferences');
  await act(async()=>{document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));});
  await act(wait);
  assert.equal(Boolean(document.querySelector('[role="dialog"]')),false);
  assert.equal(store.get().analytics,false); assert.equal(store.get().advertising,true);
  assert.ok(document.activeElement === button('Cookie Preferences'), 'Focus returns to the preferences trigger');
});

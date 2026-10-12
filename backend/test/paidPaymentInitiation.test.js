process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-payment-initiation";
process.env.JWT_SECRET = "payment-initiation-fixture-secret";
process.env.BOKUN_MOCK_MODE = "true";
process.env.DPO_MOCK_MODE = "false";
process.env.DPO_COMPANY_TOKEN = "fixture-company";
process.env.DPO_SERVICE_TYPE = "80721";
process.env.DPO_ALLOW_LOCAL_REDIRECTS = "true";
process.env.PAYPAL_MOCK_MODE = "false";
process.env.PAYPAL_CLIENT_ID = "fixture-client";
process.env.PAYPAL_CLIENT_SECRET = "fixture-secret";
process.env.PAYPAL_ALLOW_LOCAL_REDIRECTS = "true";
const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const providerCalls = { dpo: 0, paypal: 0 };
let failProvider = "";
const originalAxiosCreate = axios.create;
axios.create = (...args) => {
  const client = originalAxiosCreate(...args);
  client.post = async (_url, xml) => {
    assert.match(xml, /createToken/);
    providerCalls.dpo++;
    if (failProvider === "dpo") throw new Error("Fixture transport timeout");
    return { data: '<API3G><Result>000</Result><TransToken>fixture-token-'+providerCalls.dpo+'</TransToken><TransRef>PAYMENT-FIXTURE</TransRef></API3G>' };
  };
  client.request = async ({ url }) => {
    if (url === "/v1/oauth2/token") return { data: { access_token: "fixture-token", expires_in: 3600 } };
    assert.equal(url, "/v2/checkout/orders");
    providerCalls.paypal++;
    if (failProvider === "paypal") throw new Error("Fixture transport timeout");
    return { data: { id: "fixture-order-"+providerCalls.paypal, links: [{ rel: "approve", href: "https://fixture.invalid/approve/"+providerCalls.paypal }] } };
  };
  return client;
};
const Booking = require("../src/models/Booking");
const payments = require("../src/services/payments");
const notifications = require("../src/services/notifications");
const adapters = { dpo: require("../src/services/payments/dpo"), paypal: require("../src/services/payments/paypal") };
axios.create = originalAxiosCreate;
const get = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
const set = (o, path, value) => { const parts = path.split("."); const last = parts.pop(); for (const key of parts) o = o[key] ||= {}; o[last] = structuredClone(value); };
const matches = (state, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$or") return value.some((q) => matches(state, q));
  if (key === "$and") return value.every((q) => matches(state, q));
  const actual = get(state, key);
  if (value && typeof value === "object") {
    if ("$exists" in value) return (actual !== undefined) === value.$exists;
    if ("$in" in value) return value.$in.includes(actual);
    if ("$ne" in value) return actual !== value.$ne;
  }
  return actual === value;
});
function harness(t, overrides = {}) {
  providerCalls.dpo = 0; providerCalls.paypal = 0; failProvider = "";
  const state = { _id: "booking-fixture", bookingReference: "PAYMENT-FIXTURE", paymentStatus: "paid", bookingStatus: "pending", supplierStatus: "supplier_pending", amount: 100, currency: "USD", pendingCheckout: { checkoutPayload: {}, finalization: { status: "pending_retry" } }, ...overrides };
  const doc = () => { const value = structuredClone(state); value.save = async () => { Object.assign(state, structuredClone(Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "function")))); return value; }; return value; };
  const updates = [];
  t.mock.method(Booking, "findById", async () => doc());
  t.mock.method(Booking, "findOneAndUpdate", async (query, update) => {
    updates.push({ query, update });
    if (!matches(state, query)) return null;
    for (const [key, value] of Object.entries(update.$set || {})) set(state, key, value);
    return doc();
  });
  t.mock.method(Booking, "updateOne", async (query, update) => {
    if (!matches(state, query)) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(update.$set || {})) set(state, key, value);
    return { matchedCount: 1 };
  });
  const lookup = t.mock.method(payments, "findLatestPaymentByBookingReference", async () => null);
  const create = t.mock.method(payments, "createPaymentIntent", async () => ({ intentId: "fixture-intent" }));
  t.mock.method(payments, "updatePaymentStatus", async () => ({}));
  const notify = t.mock.method(notifications, "notifyPaymentOrderCreated", async () => {});
  return { state, doc, updates, lookup, create, notify, initiate: (provider, payload = {}) => adapters[provider].createPayment({ payload: { bookingId: state._id, ...payload }, requestId: "fixture" }) };
}
for (const provider of Object.keys(adapters)) {
  for (const bokunBookingId of [undefined, "supplier-123"]) {
    test(provider + " paid booking never opens payment, with supplier ID " + Boolean(bokunBookingId), async (t) => {
      const h = harness(t, { bokunBookingId }); const before = structuredClone(h.state);
      const results = await Promise.all([h.initiate(provider), h.initiate(provider), h.initiate(provider)]);
      assert.ok(results.every((r) => r.paymentStatus === "paid" && r.redirectUrl === ""));
      assert.deepEqual(h.state, before); assert.equal(h.create.mock.callCount(), 0); assert.equal(h.notify.mock.callCount(), 0); assert.equal(providerCalls[provider],0);
    });
  }
  test(provider + " historical paid booking does not need checkout payload or matching new money", async (t) => {
    const h = harness(t, { pendingCheckout: undefined });
    assert.equal((await h.initiate(provider, { amount: 999, currency: "EUR" })).paymentStatus, "paid");
    assert.equal(h.state.amount, 100); assert.equal(h.state.currency, "USD");
  });
}

for (const provider of Object.keys(adapters)) {
  for (const paymentStatus of ['pending','failed']) {
    test(provider+' '+paymentStatus+' initiation creates one attempt and repeated calls reuse it',async(t)=>{
      const h=harness(t,{paymentStatus,bookingStatus:paymentStatus==='failed'?'failed':'pending'});
      const first=await h.initiate(provider);
      const marker=structuredClone(h.state.paymentInitiation);
      const second=await h.initiate(provider);
      assert.deepEqual(second,first);
      assert.equal(h.state.paymentStatus,'pending');
      assert.equal(h.state.bookingStatus,'pending');
      assert.equal(h.create.mock.callCount(),1);
      assert.equal(h.notify.mock.callCount(),1);
      assert.equal(providerCalls[provider],1);
      assert.deepEqual(h.state.paymentInitiation,marker);
      assert.equal(h.state.pendingCheckout.finalization.status,'pending_retry');
    });
  }
  test(provider+' concurrent unpaid initiation creates one provider attempt',async(t)=>{
    const h=harness(t,{paymentStatus:'pending'});
    const results=await Promise.allSettled([h.initiate(provider),h.initiate(provider)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'PAYMENT_INITIATION_REQUIRES_REVIEW');
    assert.equal(h.create.mock.callCount(),1);
    assert.equal(h.notify.mock.callCount(),1);
  });
  test(provider+' verification racing order persistence cannot reset paid or return redirect',async(t)=>{
    const h=harness(t,{paymentStatus:'pending'});
    const update=Booking.findOneAndUpdate;
    t.mock.method(Booking,'findOneAndUpdate',async(query,patch)=>{
      if(patch.$set?.paymentStatus==='pending') h.state.paymentStatus='paid';
      return update(query,patch);
    });
    const result=await h.initiate(provider);
    assert.equal(h.state.paymentStatus,'paid');
    assert.equal(result.paymentStatus,'paid'); assert.equal(result.redirectUrl,'');
    assert.equal(h.create.mock.callCount(),0);
    assert.ok(h.state.paymentInitiation.response);
  });
  for(const status of ['refunded','reversed','disputed','chargeback']) {
    test(provider+' '+status+' never opens a new payment by default',async(t)=>{
      const h=harness(t,{paymentStatus:status});
      await assert.rejects(h.initiate(provider),{code:'PAYMENT_INITIATION_REQUIRES_REVIEW'});
      assert.equal(h.create.mock.callCount(),0);
    });
  }
  test(provider+' incomplete attempt survives stale checkout overwrite and cannot replay',async(t)=>{
    const h=harness(t,{paymentStatus:'pending',paymentInitiation:{token:'old-owner',provider,status:'submitting'}});
    h.state.pendingCheckout={checkoutPayload:{}};
    await assert.rejects(h.initiate(provider),{code:'PAYMENT_INITIATION_REQUIRES_REVIEW'});
    assert.equal(h.create.mock.callCount(),0);
  });
  test(provider+' verified payment record blocks initiation despite stale booking snapshot',async(t)=>{
    const h=harness(t,{paymentStatus:'pending'});
    t.mock.method(payments,'findLatestPaymentByBookingReference',async()=>({status:'paid',verificationStatus:'verified'}));
    const result=await h.initiate(provider);
    assert.equal(result.paymentStatus,'paid');assert.equal(result.redirectUrl,'');
    assert.equal(h.create.mock.callCount(),0);
  });
}

for(const provider of Object.keys(adapters)) {
  test(provider+' ambiguous transport outcome never creates a second order',async(t)=>{
    const h=harness(t,{paymentStatus:'pending'}); failProvider=provider;
    await assert.rejects(h.initiate(provider),/Fixture transport timeout/);
    failProvider='';
    await assert.rejects(h.initiate(provider),{code:'PAYMENT_INITIATION_REQUIRES_REVIEW'});
    assert.equal(providerCalls[provider],1);
  });
  test(provider+' definitive failed attempt may start one new attempt',async(t)=>{
    const h=harness(t,{paymentStatus:'pending'});
    await h.initiate(provider); const firstToken=h.state.paymentInitiation.token;
    h.state.paymentStatus='failed';
    await h.initiate(provider);
    assert.notEqual(h.state.paymentInitiation.token,firstToken);
    assert.equal(providerCalls[provider],2);
  });
}

for(const provider of Object.keys(adapters)) {
 test(provider+' verification winning the initiation claim prevents any provider order',async(t)=>{
  const h=harness(t,{paymentStatus:'pending'}); const update=Booking.findOneAndUpdate;
  t.mock.method(Booking,'findOneAndUpdate',async(query,patch)=>{
   if(patch.$set?.paymentInitiation) h.state.paymentStatus='paid';
   return update(query,patch);
  });
  const result=await h.initiate(provider);
  assert.equal(result.paymentStatus,'paid'); assert.equal(result.redirectUrl,'');
  assert.equal(providerCalls[provider],0); assert.equal(h.state.paymentStatus,'paid');
 });
}

for(const provider of Object.keys(adapters)) {
 test(provider+' a paid cancel callback without supplier ID cannot report failed payment',async(t)=>{
  const h=harness(t);
  const result=await adapters[provider].handlePaymentCancel({bookingId:h.state._id});
  assert.equal(result.status,'paid');assert.equal(h.state.paymentStatus,'paid');assert.equal(providerCalls[provider],0);
 });
 test(provider+' cancellation racing payment persistence is never overwritten',async(t)=>{
  const h=harness(t,{paymentStatus:'pending'});const update=Booking.findOneAndUpdate;
  t.mock.method(Booking,'findOneAndUpdate',async(query,patch)=>{
   if(patch.$set?.paymentStatus==='pending') h.state.bookingStatus='cancelled';
   return update(query,patch);
  });
  await assert.rejects(h.initiate(provider),{code:'PAYMENT_INITIATION_REQUIRES_REVIEW'});
  assert.equal(h.state.bookingStatus,'cancelled');
 });
}

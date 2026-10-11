const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
module.exports = async ({ call, record, ctx }) => {
  const option = ctx.detail.options[0];
  const catalog = ctx.detail.priceCatalogs?.[0];
  const base = {
    productId: ctx.tour.bokunProductId,
    optionId: option.bokunOptionId,
    travelDate: day(30),
    pax: { adults: 2, children: 0, infants: 0 },
    ...(catalog ? { priceCatalogId: String(catalog.catalogId || catalog.id) } : {})
  };
  const quote = await call("POST", "/bookings/quote", { body: base });
  ctx.quote = quote.json?.data;
  record("booking quote", quote.ok && Boolean(ctx.quote?.quoteToken), `status ${quote.status} ${quote.ok ? "" : JSON.stringify(quote.json).slice(0, 300)}, ${quote.ms}ms`);
  if (!ctx.quote?.quoteToken) return;

  const customer = { firstName: "Local", lastName: "Tester", email: "guest@example.test", phone: "+255778775044", country: "TZ", hotelName: "Test Hotel" };
  let answers = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
  const create = await call("POST", "/payments/pesapal/create", {
    body: { ...base, priceCategoryParticipants: ctx.quote.priceCategoryParticipants || [], quoteToken: ctx.quote.quoteToken, customer, bookingQuestions: answers, paymentMethod: "pesapal", amount: Number(ctx.quote.pricing?.finalPayable || 0), currency: ctx.quote.pricing?.currency || "USD" }
  });
  ctx.payment = create.json?.data;
  const missing = create.json?.error?.details?.missingQuestions || [];
  if (create.status === 422 && missing.length && attempt === 0) {
    record("required booking questions enforced", true, missing.map((q) => q.questionId).join(","));
    answers = missing.flatMap((q) => q.scope === "passenger" ? [0, 1].map((i) => ({ questionId: q.questionId, label: q.label, scope: q.scope, passengerIndex: i, answer: "Local Tester " + (i + 1) })) : [{ questionId: q.questionId, label: q.label, scope: q.scope, answer: q.options?.[0]?.value || "yes" }]);
    continue;
  }
  record("pesapal checkout create (mock)", create.ok, `status ${create.status} ${create.ok ? "" : JSON.stringify(create.json).slice(0, 400)}, ${create.ms}ms`);
  break;
  }

  const trackingId = ctx.payment?.orderTrackingId || ctx.payment?.OrderTrackingId;
  const merchantRef = ctx.payment?.merchantReference || ctx.payment?.bookingReference;
  const success = await call('GET', '/payments/pesapal/success?OrderTrackingId=' + encodeURIComponent(trackingId) + '&OrderMerchantReference=' + encodeURIComponent(merchantRef || ''));
  ctx.success = success.json?.data;
  record('pesapal success callback (mock)', success.ok, 'status ' + success.status + ' ' + (success.ok ? '' : JSON.stringify(success.json).slice(0, 300)) + ', ' + success.ms + 'ms');
  const ipn = await call('GET', '/payments/pesapal/ipn?OrderTrackingId=' + encodeURIComponent(trackingId) + '&OrderMerchantReference=' + encodeURIComponent(merchantRef || '') + '&OrderNotificationType=IPNCHANGE');
  record('pesapal IPN (mock, replay)', ipn.ok, 'status ' + ipn.status + ' ' + JSON.stringify(ipn.json).slice(0, 200));
};

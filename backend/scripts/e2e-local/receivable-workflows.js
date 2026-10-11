// Local end-to-end verification of customer receivable workflows: partial/cash/bank/FX payments, booking
// modification after payment, invoice adjustments, standalone invoices and OTA supplier-net settlement.
// Isolated database, mocked integrations, email off, outbound HTTP blocked; posting automation is enabled ONLY in
// this local process. Usage (from backend/): npm run test:receivables-local — needs local MongoDB (replica set).
const path = require("node:path");
const { spawn } = require("node:child_process");

const backendDir = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const PORT = 5057;
const BASE = `http://127.0.0.1:${PORT}/api`;
const DB = "mongodb://127.0.0.1:27017/bokun_fin_workflows_local";
const ADMIN = { email: "workflow-admin@example.test", password: "Workflow-Local-Passw0rd!" };

const ENV = {
  NODE_ENV: "development",
  PORT: String(PORT),
  MONGO_URI: DB,
  JWT_SECRET: "workflow-local-only-jwt-signing-value-0123456789",
  FRONTEND_URL: "http://localhost:5173",
  PASSWORD_RESET_SITE_URL: "http://localhost:5173",
  DEFAULT_CURRENCY: "USD",
  ACCOUNTING_BASE_CURRENCY: "USD",
  BOKUN_MOCK_MODE: "true",
  BOKUN_ACCESS_KEY: "mock-access",
  BOKUN_SECRET_KEY: "mock-secret",
  BOKUN_BASE_URL: "http://127.0.0.1:9",
  BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED: "false",
  PESAPAL_MOCK_MODE: "true",
  PESAPAL_MOCK_CONFIRMS_PAYMENT: "true",
  PESAPAL_CONSUMER_KEY: "mock-key",
  PESAPAL_CONSUMER_SECRET: "mock-secret",
  PESAPAL_IPN_ID: "mock-ipn",
  PESAPAL_BASE_URL: "http://127.0.0.1:9",
  PESAPAL_ALLOW_LOCAL_REDIRECTS: "true",
  PESAPAL_SUCCESS_URL: "http://localhost:5173/payment-success",
  PESAPAL_CANCEL_URL: "http://localhost:5173/payment-failure",
  EMAIL_ENABLED: "false",
  RATE_LIMIT_MAX: "100000",
  CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED: "true",
  REVENUE_RECOGNITION_AUTOMATIC_ENABLED: "true",
  REVENUE_RECOGNITION_ACTIVATED_AT: new Date(Date.now() - 60 * 1000).toISOString(),
  REVENUE_RECOGNITION_ACTIVATION_SCOPE: "NEW_COMPLETIONS"
};

const results = [];
const record = (scenario, name, ok, detail = "") => {
  results.push({ scenario, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${scenario}] ${name}${detail ? `  (${detail})` : ""}`);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 260);
const num = (value) => Number(value?.$numberDecimal ?? value?.toString?.() ?? value ?? 0);
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.005;

let token = "";
const call = async (method, url, body, { anonymous = false } = {}) => {
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token && !anonymous ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await response.json(); } catch (_error) { json = null; }
  return { status: response.status, ok: response.ok, json, data: json?.data, code: json?.error?.code };
};

const startServer = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["-r", path.join(__dirname, "blocknet.js"), path.join(backendDir, "server.js")], {
    cwd: __dirname,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...ENV },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  const onData = (chunk) => {
    const text = chunk.toString();
    logs.push(text);
    if (text.includes("Server started")) resolve({ child, logs });
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => reject(new Error(`server exited ${code}: ${logs.join("").slice(-2000)}`)));
});

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const main = async () => {
  Object.assign(process.env, ENV);
  const r = (p) => require(path.join(backendDir, p));
  const mongoose = r("node_modules/mongoose");
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();
  await r("src/services/auth").registerAdmin({ firstName: "Workflow", lastName: "Admin", ...ADMIN, role: "super_admin" }, null);
  const db = mongoose.connection.db;
  const { child, logs } = await startServer();
  const importer = r("src/services/bokunConfirmedBookings");
  const { mapBokunBookingForImport } = r("src/integrations/bokun/confirmedBooking.mapper");
  const { mapBookingResponse } = r("src/integrations/bokun/bokun.mapper");
  const { mockConfirmedBooking } = r("src/integrations/bokun/mockBokunData");
  const bookingsService = r("src/services/bookings");

  const accountBalance = async (mappingKey) => {
    const code = (await db.collection("accountingmappings").findOne({ mappingKey }))?.accountCode;
    const tb = (await call("GET", "/admin/accounting/trial-balance")).data;
    const row = (tb.items || []).find((item) => item.accountCode === code);
    return row ? num(row.closingDebit) - num(row.closingCredit) : 0;
  };
  const invoiceOf = (bookingReference) => db.collection("invoices").findOne({ bookingReference });
  const postAllPayments = async (bookingReference) => {
    const rows = await db.collection("payments").find({ bookingReference, status: "paid" }).toArray();
    const out = [];
    for (const row of rows) out.push(await call("POST", "/admin/accounting/postings/customer-payment", { paymentId: String(row._id) }));
    return out;
  };
  // Bokun-imported booking (e.g. booked in the Bokun back office, paid later), created through the real importer.
  const importBooking = async ({ reference, total, paid = 0, channel = "Direct Website", productId = "bk_prod_znz_dolphin" }) => {
    const raw = mockConfirmedBooking({ reference, channel: { title: channel } });
    Object.assign(raw.booking, {
      totalPrice: total, totalPaid: paid, totalDue: total - paid, paidType: paid >= total ? "PAID_IN_FULL" : "NOT_PAID",
      customer: { firstName: "Imported", lastName: reference, email: `${reference.toLowerCase()}@example.test`, phoneNumber: "+255700000001", country: "TZ" }
    });
    raw.booking.activityBookings[0].productId = productId;
    raw.booking.activityBookings[0].date = day(10);
    raw.booking.activityBookings[0].totalPrice = total;
    // Same two steps as the real sync: normalise the Bokun lookup response, then map it for import.
    const mapped = mapBokunBookingForImport({ bokunBooking: mapBookingResponse(raw) });
    const imported = await importer.importMappedBooking({ mapped, source: "manual" });
    const booking = await db.collection("bookings").findOne({ bokunBookingId: `mock_${reference}` }) || await db.collection("bookings").findOne({ bokunConfirmationCode: reference });
    if (booking && !(await invoiceOf(booking.bookingReference))) await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference });
    return { imported, booking: booking ? await db.collection("bookings").findOne({ _id: booking._id }) : null };
  };
  const complete = async (booking) => {
    await db.collection("bookings").updateOne({ _id: booking._id }, { $set: { "bokunOperationalEvidence.activityStatus": "ARRIVED" } });
    const response = await call("POST", "/admin/service-completions", {
      bookingReference: booking.bookingReference, serviceKey: booking.bokunProductId, status: "COMPLETED", evidenceSource: "ADMIN_CONFIRMATION",
      completedAt: new Date().toISOString(), reason: "Local workflow: guest arrived (fixture evidence)"
    });
    return { response, recognition: await db.collection("revenuerecognitions").findOne({ bookingReference: booking.bookingReference }) };
  };
  const pay = (invoiceNumber, body) => call("POST", "/admin/business-accounting/receivables/payments", { invoiceNumber, ...body });

  try {
    token = (await call("POST", "/auth/login", ADMIN)).data?.token;
    const now = new Date();
    const setup = [
      await call("POST", "/admin/accounting/chart-of-accounts/seed-defaults", { dryRun: false }),
      await call("POST", "/admin/accounting/mappings/seed-defaults", { dryRun: false }),
      await call("POST", "/admin/accounting/periods", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })
    ];
    // OTA receivable and FX accounts are an owner decision; these LOCAL FIXTURE accounts exist only in this database.
    for (const [code, name, type, subtype, mappingKey] of [
      ["1191", "LOCAL FIXTURE GYG receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "GYG_RECEIVABLE"],
      ["1192", "LOCAL FIXTURE Viator receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "VIATOR_RECEIVABLE"],
      ["1193", "LOCAL FIXTURE OTA receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "OTA_RECEIVABLE"],
      ["7191", "LOCAL FIXTURE FX gain", "OTHER_INCOME", "OTHER_INCOME", "FX_GAIN"],
      ["7991", "LOCAL FIXTURE FX loss", "OTHER_EXPENSE", "OTHER_EXPENSE", "FX_LOSS"]
    ]) {
      await db.collection("chartofaccounts").updateOne({ code }, { $setOnInsert: { code, name, type, subtype, active: true, allowManualPosting: false, currency: "USD", createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
      await db.collection("accountingmappings").updateOne({ mappingKey }, { $set: { mappingKey, accountCode: code, active: true, description: name } }, { upsert: true });
    }
    record("setup", "chart, mappings, period, fixture OTA/FX accounts", Boolean(token) && setup.every((item) => item.ok));

    // ------------------------------------------------------------------ W1 partial / cash / bank / FX payments
    const w1 = await importBooking({ reference: "LOCAL-UNPAID-200", total: 200 });
    const w1ref = w1.booking?.bookingReference;
    const w1inv = await invoiceOf(w1ref);
    record("W1 payments", "imported unpaid booking has a 200 receivable", w1inv && near(w1inv.balanceDue, 200) && w1.booking.bookingStatus === "confirmed", `${w1.booking?.bookingStatus} total ${w1inv?.total} due ${w1inv?.balanceDue}`);
    const p1 = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 50, currency: "USD", evidenceReference: "RCPT-0001", idempotencyKey: "w1-cash-1" });
    let inv = await invoiceOf(w1ref);
    let bk = await db.collection("bookings").findOne({ bookingReference: w1ref });
    record("W1 payments", "partial cash 50 -> invoice partial, balance 150, booking partial", p1.status === 201 && inv.paymentStatus === "partial" && near(inv.balanceDue, 150) && bk.paymentStatus === "partial", `${p1.status} ${inv.paymentStatus} due ${inv.balanceDue} booking ${bk.paymentStatus} ${short(p1.json?.message)}`);
    const replay = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 50, currency: "USD", evidenceReference: "RCPT-0001", idempotencyKey: "w1-cash-1" });
    const reuse = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 60, currency: "USD", evidenceReference: "RCPT-0099", idempotencyKey: "w1-cash-1" });
    const dupEvidence = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 10, currency: "USD", evidenceReference: "RCPT-0001", idempotencyKey: "w1-cash-dup" });
    const over = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 500, currency: "USD", evidenceReference: "RCPT-0500", idempotencyKey: "w1-over" });
    const noFx = await pay(w1inv.invoiceNumber, { method: "BANK_TRANSFER", amount: 260000, currency: "TZS", evidenceReference: "BANK-NOFX", idempotencyKey: "w1-nofx" });
    const paymentsAfterRejections = await db.collection("payments").countDocuments({ bookingReference: w1ref });
    record("W1 duplicates", "replay returns the same payment", replay.status === 200 && replay.data?.replay === true, `${replay.status}`);
    record("W1 duplicates", "idempotency key reuse with different amount refused", reuse.status === 409 && reuse.code === "IDEMPOTENCY_KEY_REUSED", `${reuse.status} ${reuse.code}`);
    record("W1 duplicates", "same receipt reference refused", dupEvidence.status === 409 && dupEvidence.code === "DUPLICATE_PAYMENT_EVIDENCE", `${dupEvidence.status} ${dupEvidence.code}`);
    record("W1 failed transactions", "overpayment refused", over.status === 409 && over.code === "OVERPAYMENT_NOT_ALLOWED", `${over.status} ${over.code}`);
    record("W1 failed transactions", "foreign currency without FX evidence refused", noFx.status === 422 && noFx.code === "FX_EVIDENCE_REQUIRED", `${noFx.status} ${noFx.code}`);
    record("W1 failed transactions", "rejected requests persisted nothing", paymentsAfterRejections === 1, `payments ${paymentsAfterRejections}`);
    const fx = await pay(w1inv.invoiceNumber, { method: "BANK_TRANSFER", amount: 260000, currency: "TZS", evidenceReference: "BANK-TZS-1", idempotencyKey: "w1-bank-tzs", fx: { rate: 0.0004, source: "Bank advice", date: day(0) } });
    inv = await invoiceOf(w1ref);
    record("W1 multi-currency", "260,000 TZS @ 0.0004 = 104.00 USD applied", fx.status === 201 && near(fx.data?.payment?.accountingAmount, 104) && near(inv.amountPaid, 154) && near(inv.balanceDue, 46), `paid ${inv.amountPaid} due ${inv.balanceDue}`);
    const mm = await pay(w1inv.invoiceNumber, { method: "MOBILE_MONEY", amount: 46, currency: "USD", evidenceReference: "MM-TX-1", idempotencyKey: "w1-mm" });
    inv = await invoiceOf(w1ref);
    const fullBeforeVoid = inv.paymentStatus === "paid";
    const voided = await call("POST", `/admin/business-accounting/receivables/payments/${mm.data?.payment?._id}/void`, { reason: "Mobile money reversal by operator (bounced)" });
    inv = await invoiceOf(w1ref);
    record("W1 failed transactions", "bounced mobile money voided; balance back to 46", fullBeforeVoid && voided.ok && near(inv.balanceDue, 46) && inv.paymentStatus === "partial", `${voided.status} due ${inv.balanceDue} ${inv.paymentStatus}`);
    const p3 = await pay(w1inv.invoiceNumber, { method: "CASH", amount: 46, currency: "USD", evidenceReference: "RCPT-0002", idempotencyKey: "w1-cash-2" });
    inv = await invoiceOf(w1ref);
    bk = await db.collection("bookings").findOne({ bookingReference: w1ref });
    record("W1 payments", "final cash 46 -> invoice paid 200, balance 0, booking paid", p3.ok && inv.paymentStatus === "paid" && near(inv.amountPaid, 200) && near(inv.balanceDue, 0) && bk.paymentStatus === "paid", `${inv.paymentStatus} paid ${inv.amountPaid}`);
    const postedW1 = await postAllPayments(w1ref);
    record("W1 ledger", "three verified receipts post as customer deposits", postedW1.length === 3 && postedW1.every((item) => ["created", "posted"].includes(item.data?.action) && item.data?.eligibility?.treatment === "CUSTOMER_DEPOSIT"), short(postedW1.map((item) => [item.data?.action, item.data?.eligibility?.blockers])));
    const voidPosted = await call("POST", `/admin/business-accounting/receivables/payments/${p1.data?.payment?._id}/void`, { reason: "Attempted void after posting" });
    record("W1 failed transactions", "posted payment cannot be silently voided", voidPosted.status === 409 && voidPosted.code === "REVERSAL_JOURNAL_REQUIRED", `${voidPosted.status} ${voidPosted.code}`);
    const w1done = await complete(w1.booking);
    record("W1 ledger", "completion releases the 200 deposit to revenue", w1done.recognition?.status === "POSTED", `${w1done.recognition?.status} ${short(w1done.response.data?.accounting?.eligibility?.blockers || w1done.recognition?.blockers)}`);

    // ------------------------------------------------------------------ W2 booking modification after payment
    const tours = (await call("GET", "/tours?page=1&limit=5")).data || [];
    // Expected figures assume the 2 x 85 USD dolphin tour; pick it explicitly (listing order varies).
    const pinned = tours.find((item) => item.bokunProductId === "bk_prod_znz_dolphin") || tours[0];
    const tour = (await call("GET", `/tours/${pinned.slug}`)).data;
    const option = tour.options.find((item) => item.bokunOptionId.includes("shared")) || tour.options[0];
    const checkout = async (label) => {
      const base = { productId: tour.bokunProductId, optionId: option.bokunOptionId, travelDate: day(25), pax: { adults: 2, children: 0, infants: 0 }, priceCatalogId: String(tour.priceCatalogs[0].catalogId || tour.priceCatalogs[0].id) };
      const quote = (await call("POST", "/bookings/quote", base, { anonymous: true })).data;
      const created = (await call("POST", "/payments/pesapal/create", { ...base, priceCategoryParticipants: quote.priceCategoryParticipants || [], quoteToken: quote.quoteToken, customer: { firstName: "Mod", lastName: label, email: `${label}@example.test`, phone: "+255778775044", country: "TZ", hotelName: "Test Hotel" }, bookingQuestions: [], paymentMethod: "pesapal", amount: Number(quote.pricing.finalPayable), currency: quote.pricing.currency }, { anonymous: true })).data;
      await call("GET", `/payments/pesapal/success?OrderTrackingId=${encodeURIComponent(created.orderTrackingId)}&OrderMerchantReference=${encodeURIComponent(created.merchantReference)}`);
      return { ...created, email: `${label}@example.test` };
    };
    const changeTravelers = (booking, adults) => call("POST", `/bookings/${booking.bookingId}/requests`, { customerEmail: booking.email, type: "change_travelers", requestedChanges: { travelers: { adults, children: 0, infants: 0 } }, customerReason: "Local workflow traveler change" }, { anonymous: true });

    const up = await checkout("modup");
    await postAllPayments(up.bookingReference);
    const upReq = await changeTravelers(up, 3);
    const upApprove = await call("POST", `/admin/booking-requests/${upReq.data?.id}/approve`, { customerFacingReason: "Approved", paymentProvider: "cash" });
    const adjustment = await db.collection("paymentadjustments").findOne({ bookingId: new mongoose.Types.ObjectId(up.bookingId) });
    record("W2 modification", "price increase 170 -> 255 requires an 85 additional payment", adjustment && near(adjustment.amount, 85), `${upApprove.status} ${short(upApprove.json?.message)} adjustment ${adjustment?.amount}`);
    const markPaid = adjustment ? await call("POST", `/admin/payment-adjustments/${adjustment._id}/mark-paid`, { paymentReference: "CASH-ADJ-1" }) : null;
    const upBooking = await db.collection("bookings").findOne({ bookingReference: up.bookingReference });
    const upInvoice = await invoiceOf(up.bookingReference);
    record("W2 modification", "booking, invoice and revenue basis all 255 and fully paid", markPaid?.ok && near(upBooking.amount, 255) && near(upBooking.pricingSnapshot.finalPayable, 255) && near(upInvoice.total, 255) && near(upInvoice.balanceDue, 0), `amount ${upBooking.amount} final ${upBooking.pricingSnapshot.finalPayable} gross ${upBooking.pricingSnapshot.grossAmount} invoice ${upInvoice.total} due ${upInvoice.balanceDue}`);
    const upPosts = await postAllPayments(up.bookingReference);
    record("W2 modification", "cash adjustment posts to deposit (original already posted)", upPosts.some((item) => ["created", "posted"].includes(item.data?.action)) && upPosts.some((item) => item.data?.action === "existing"), short(upPosts.map((item) => [item.data?.action, item.data?.eligibility?.blockers])));
    const upDone = await complete(await db.collection("bookings").findOne({ bookingReference: up.bookingReference }));
    record("W2 modification", "recognition releases 255 of deposit", upDone.recognition?.status === "POSTED" && near(upDone.recognition?.originalAmount, 255), `${upDone.recognition?.status} ${num(upDone.recognition?.originalAmount)} ${short(upDone.recognition?.blockers)}`);

    const down = await checkout("moddown");
    await postAllPayments(down.bookingReference);
    const downReq = await changeTravelers(down, 1);
    // No supplier booking ID: the live path cannot sync automatically and needs operator confirmation.
    await db.collection("bookings").updateOne({ bookingReference: down.bookingReference }, { $set: { bokunBookingId: "" } });
    const downApprove = await call("POST", `/admin/booking-requests/${downReq.data?.id}/approve`, { customerFacingReason: "Approved", refundProvider: "pesapal" });
    const pending = await db.collection("bookingrequests").findOne({ _id: new mongoose.Types.ObjectId(downReq.data?.id) });
    record("W2 supplier confirmation", "unsynced change waits for supplier confirmation", pending?.bokunSync?.status === "manual_action_required", `${downApprove.status} ${pending?.bokunSync?.status}`);
    const noEvidence = await call("POST", `/admin/booking-requests/${downReq.data?.id}/confirm-supplier-change`, { supplierReference: "", evidenceNote: "" });
    const confirmed = await call("POST", `/admin/booking-requests/${downReq.data?.id}/confirm-supplier-change`, { supplierReference: "BOKUN-AMEND-77", evidenceNote: "Changed to 1 adult in Bokun back office" });
    const downBooking = await db.collection("bookings").findOne({ bookingReference: down.bookingReference });
    let downInvoice = await invoiceOf(down.bookingReference);
    const refund = await db.collection("refunds").findOne({ bookingId: new mongoose.Types.ObjectId(down.bookingId) });
    record("W2 supplier confirmation", "confirmation requires evidence", noEvidence.status === 422, `${noEvidence.status}`);
    record("W2 supplier confirmation", "confirmed change: booking and invoice 85, refund 85 created", confirmed.ok && near(downBooking.amount, 85) && near(downInvoice.total, 85) && refund && near(refund.amount, 85), `${confirmed.status} ${short(confirmed.json?.message)} amount ${downBooking.amount} invoice ${downInvoice.total} refund ${refund?.amount}`);
    if (refund) {
      await call("POST", `/admin/refunds/${refund._id}/process`, { confirm: true });
      await call("POST", `/admin/refunds/${refund._id}/status`, { status: "refunded", providerRefundReference: "PESAPAL-RF-DOWN", confirmedAmount: 85, evidenceNote: "Local workflow provider confirmation fixture" });
      const refundPost = await call("POST", "/admin/accounting/postings/customer-refund", { refundId: String(refund._id) });
      downInvoice = await invoiceOf(down.bookingReference);
      record("W2 supplier confirmation", "refund 85 posted against deposit; invoice settled", ["created", "posted"].includes(refundPost.data?.action) && refundPost.data?.eligibility?.debitMappingKey === "CUSTOMER_DEPOSIT" && near(downInvoice.balanceDue, 0), `${refundPost.data?.action} due ${downInvoice.balanceDue} net ${downInvoice.netAmountPaid}`);
    }

    // ------------------------------------------------------------------ W3 invoice adjustments
    const w3 = await importBooking({ reference: "LOCAL-ADJ-300", total: 300 });
    const w3inv = await invoiceOf(w3.booking.bookingReference);
    const adjust = (body) => call("POST", `/admin/business-accounting/invoices/${w3inv.invoiceNumber}/adjustments`, body);
    const creditPreview = await adjust({ type: "CREDIT_NOTE", amount: 40, currency: "USD", reason: "Goodwill discount", dryRun: true });
    const creditNoApproval = await adjust({ type: "CREDIT_NOTE", amount: 40, currency: "USD", reason: "Goodwill discount", idempotencyKey: creditPreview.data?.idempotencyKey });
    const credit = await adjust({ type: "CREDIT_NOTE", amount: 40, currency: "USD", reason: "Goodwill discount", approvalId: "APPROVAL-LOCAL-1", idempotencyKey: creditPreview.data?.idempotencyKey });
    const creditReplay = await adjust({ type: "CREDIT_NOTE", amount: 40, currency: "USD", reason: "Goodwill discount", approvalId: "APPROVAL-LOCAL-1", idempotencyKey: creditPreview.data?.idempotencyKey });
    let w3booking = await db.collection("bookings").findOne({ bookingReference: w3.booking.bookingReference });
    let w3after = await invoiceOf(w3.booking.bookingReference);
    record("W3 adjustments", "preview shows 300 -> 260 without changing anything", creditPreview.data?.totalAfter === "260.00" && creditPreview.data?.dryRun === true, short(creditPreview.data));
    record("W3 adjustments", "apply without approval refused", creditNoApproval.status === 422 && creditNoApproval.code === "ADJUSTMENT_APPROVAL_REQUIRED", `${creditNoApproval.status} ${creditNoApproval.code}`);
    record("W3 adjustments", "credit note 40: invoice 260 and revenue basis 260", credit.ok && near(w3after.total, 260) && near(w3after.balanceDue, 260) && near(w3booking.pricingSnapshot.finalPayable, 260), `invoice ${w3after.total} basis ${w3booking.pricingSnapshot.finalPayable} ${short(credit.json?.message)}`);
    record("W3 adjustments", "applying the same note twice is idempotent", creditReplay.data?.action === "existing" && (await db.collection("invoiceadjustments").countDocuments({ invoiceNumber: w3inv.invoiceNumber })) === 1, creditReplay.data?.action);
    const tooMuch = await adjust({ type: "CREDIT_NOTE", amount: 400, currency: "USD", reason: "Too large", dryRun: true });
    const wrongCurrency = await adjust({ type: "CREDIT_NOTE", amount: 10, currency: "EUR", reason: "Wrong currency", dryRun: true });
    record("W3 adjustments", "credit above unpaid balance refused (use refund workflow)", tooMuch.status === 409 && tooMuch.code === "CREDIT_EXCEEDS_UNPAID_BALANCE", `${tooMuch.status} ${tooMuch.code}`);
    record("W3 adjustments", "adjustment in another currency refused", wrongCurrency.status === 422 && wrongCurrency.code === "ADJUSTMENT_CURRENCY_MISMATCH", `${wrongCurrency.status} ${wrongCurrency.code}`);
    const debitPreview = await adjust({ type: "DEBIT_NOTE", amount: 15, currency: "USD", reason: "Late pickup surcharge", dryRun: true });
    await adjust({ type: "DEBIT_NOTE", amount: 15, currency: "USD", reason: "Late pickup surcharge", approvalId: "APPROVAL-LOCAL-2", idempotencyKey: debitPreview.data?.idempotencyKey });
    w3booking = await db.collection("bookings").findOne({ bookingReference: w3.booking.bookingReference });
    w3after = await invoiceOf(w3.booking.bookingReference);
    record("W3 adjustments", "debit note 15: invoice and basis 275", near(w3after.total, 275) && near(w3booking.pricingSnapshot.finalPayable, 275), `invoice ${w3after.total} basis ${w3booking.pricingSnapshot.finalPayable}`);
    const w3done = await complete(w3booking);
    record("W3 adjustments", "recognition uses the adjusted 275 basis (Dr AR / Cr revenue)", w3done.recognition?.status === "POSTED" && near(w3done.recognition?.originalAmount, 275), `${w3done.recognition?.status} ${num(w3done.recognition?.originalAmount)} ${short(w3done.recognition?.blockers)}`);
    const postCreditPreview = await adjust({ type: "CREDIT_NOTE", amount: 20, currency: "USD", reason: "Service issue credit", dryRun: true });
    const postCredit = await adjust({ type: "CREDIT_NOTE", amount: 20, currency: "USD", reason: "Service issue credit", approvalId: "APPROVAL-LOCAL-3", idempotencyKey: postCreditPreview.data?.idempotencyKey });
    w3after = await invoiceOf(w3.booking.bookingReference);
    record("W3 adjustments", "credit note after recognition posts Dr refunds allowance / Cr AR; balance 255", postCreditPreview.data?.accountingTreatment === "RECOGNIZED_REVENUE_CREDIT_NOTE" && postCredit.data?.adjustment?.postingStatus === "POSTED" && near(w3after.balanceDue, 255), `${postCredit.status} ${postCredit.data?.adjustment?.postingStatus} due ${w3after.balanceDue}`);
    const lateDebit = await adjust({ type: "DEBIT_NOTE", amount: 5, currency: "USD", reason: "Late surcharge", dryRun: true });
    record("W3 adjustments", "debit note after recognition refused", lateDebit.status === 409 && lateDebit.code === "DEBIT_NOTE_AFTER_RECOGNITION_REQUIRES_REVIEW", `${lateDebit.status} ${lateDebit.code}`);

    // ------------------------------------------------------------------ W4 standalone invoices
    const standaloneBody = { idempotencyKey: "w4-vehicle-hire", currency: "USD", customer: { name: "Coral Lodge Ltd", email: "accounts@coral.example" }, description: "Vehicle hire and guide", lines: [{ label: "Vehicle hire (day)", quantity: 2, unitPrice: 75 }, { label: "Guide", quantity: 1, unitPrice: 50 }] };
    const si = await call("POST", "/admin/business-accounting/invoices", standaloneBody);
    const siReplay = await call("POST", "/admin/business-accounting/invoices", standaloneBody);
    const siNumber = si.data?.invoice?.invoiceNumber;
    record("W4 standalone", "invoice 2x75 + 50 = 200 issued; replay returns it", si.status === 201 && near(si.data?.invoice?.total, 200) && siReplay.data?.replay === true && siReplay.data?.invoice?.invoiceNumber === siNumber, `${si.status} ${siNumber} total ${si.data?.invoice?.total}`);
    const siPay1 = await pay(siNumber, { method: "CASH", amount: 80, currency: "USD", evidenceReference: "RCPT-SI-1", idempotencyKey: "w4-cash" });
    const siPost1 = await postAllPayments(siNumber);
    record("W4 standalone", "80 cash before delivery is a customer deposit", siPay1.ok && siPost1[0]?.data?.eligibility?.treatment === "CUSTOMER_DEPOSIT", short(siPost1.map((item) => [item.data?.action, item.data?.eligibility?.treatment, item.data?.eligibility?.blockers])));
    const noDeliveryEvidence = await call("POST", `/admin/business-accounting/invoices/${siNumber}/delivery`, { evidenceReference: "" });
    const delivered = await call("POST", `/admin/business-accounting/invoices/${siNumber}/delivery`, { evidenceReference: "JOB-SHEET-42", note: "Vehicle returned, guide signed off" });
    record("W4 standalone", "delivery requires evidence", noDeliveryEvidence.status === 422, `${noDeliveryEvidence.status}`);
    record("W4 standalone", "delivery posts revenue 200: Dr deposit 80 + Dr AR 120", ["created", "posted"].includes(delivered.data?.action) && delivered.data?.evaluation?.depositBase === "80" && delivered.data?.evaluation?.receivableBase === "120", short({ a: delivered.data?.action, b: delivered.data?.evaluation?.blockers, d: delivered.data?.evaluation?.depositBase, r: delivered.data?.evaluation?.receivableBase }));
    const siPay2 = await pay(siNumber, { method: "BANK_TRANSFER", amount: 120, currency: "USD", evidenceReference: "BANK-SI-2", idempotencyKey: "w4-bank" });
    const siPost2 = await postAllPayments(siNumber);
    const siInvoice = await db.collection("invoices").findOne({ invoiceNumber: siNumber });
    record("W4 standalone", "120 bank after delivery settles AR; invoice paid", siPay2.ok && siPost2.some((item) => item.data?.eligibility?.treatment === "SETTLE_RECEIVABLE" && ["created", "posted"].includes(item.data?.action)) && siInvoice.paymentStatus === "paid", `${siInvoice.paymentStatus} ${short(siPost2.map((item) => [item.data?.action, item.data?.eligibility?.treatment]))}`);
    const tzs = await call("POST", "/admin/business-accounting/invoices", { idempotencyKey: "w4-tzs", currency: "TZS", customer: { name: "Stone Town Cafe" }, lines: [{ label: "Catering transfer", quantity: 1, unitPrice: 500000 }] });
    const tzsNumber = tzs.data?.invoice?.invoiceNumber;
    const tzsNoFx = await call("POST", `/admin/business-accounting/invoices/${tzsNumber}/delivery`, { evidenceReference: "JOB-TZS-1" });
    const tzsFx = await call("POST", `/admin/business-accounting/invoices/${tzsNumber}/delivery`, { evidenceReference: "JOB-TZS-1", fx: { rate: 0.0004, source: "Bank of Tanzania reference", date: day(0) } });
    record("W4 multi-currency", "TZS invoice needs FX evidence; 500,000 @ 0.0004 posts 200 USD", tzsNoFx.data?.evaluation?.blockers?.includes("FX_EVIDENCE_REQUIRED") && ["created", "posted"].includes(tzsFx.data?.action) && tzsFx.data?.evaluation?.revenueBase === "200", `${short(tzsNoFx.data?.evaluation?.blockers)} -> ${tzsFx.data?.action} ${tzsFx.data?.evaluation?.revenueBase}`);

    // ------------------------------------------------------------------ W5 OTA supplier-net recognition and settlement
    const w5 = await importBooking({ reference: "LOCAL-GYG-100", total: 100, paid: 100, channel: "GetYourGuide" });
    const w5ref = w5.booking.bookingReference;
    // Supplier-net evidence normally arrives from Bokun's seller invoice; this LOCAL FIXTURE uses the stored shape.
    await db.collection("bookings").updateOne({ bookingReference: w5ref }, { $set: { "bokunFinancialEvidence.source": "BOKUN", "bokunFinancialEvidence.status": "VERIFIED", "bokunFinancialEvidence.supplierNetAmount": "80.00", "bokunFinancialEvidence.supplierNetCurrency": "USD", "bokunFinancialEvidence.evidenceHash": "local-fixture-seller-invoice-1", "bokunFinancialEvidence.evidenceConflicts": [] } });
    const w5inv = await invoiceOf(w5ref);
    const otaPay = await pay(w5inv.invoiceNumber, { method: "CASH", amount: 10, currency: "USD", evidenceReference: "RCPT-OTA", idempotencyKey: "w5-cash" });
    record("W5 OTA", "local payment on an OTA-collected booking refused", otaPay.status === 409 && otaPay.code === "OTA_COLLECTED_BOOKING", `${otaPay.status} ${otaPay.code}`);
    const prof = (await call("GET", "/admin/booking-accounting/profitability?limit=50")).data;
    const otaItem = prof.items.find((item) => item.bookingReference === w5ref);
    record("W5 OTA", "profitability: customer gross 100, supplier-net revenue 80 (commission 20)", otaItem && near(otaItem.customerGrossRevenue, 100) && near(otaItem.revenueBasis, 80), short(otaItem && { gross: otaItem.customerGrossRevenue, net: otaItem.revenueBasis, source: otaItem.revenueBasisSource }));
    const w5done = await complete(await db.collection("bookings").findOne({ bookingReference: w5ref }));
    record("W5 OTA", "recognition at supplier net: Dr GYG receivable 80 / Cr revenue 80", w5done.recognition?.status === "POSTED" && near(w5done.recognition?.originalAmount, 80), `${w5done.recognition?.status} ${num(w5done.recognition?.originalAmount)} ${short(w5done.recognition?.blockers)}`);
    const settle = await call("POST", "/admin/settlements", { settlementReference: "GYG-PAYOUT-LOCAL-1", provider: "GETYOURGUIDE", grossAmount: 100, grossCurrency: "USD", commissionAmount: 20, commissionCurrency: "USD", receivedAmount: 80, receivedCurrency: "USD", settlementDate: new Date().toISOString(), receivedVia: "PROVIDER_PAYOUT", evidenceSource: "PROVIDER_STATEMENT", evidenceReference: "gyg-statement-local-1" });
    const settlementId = settle.data?.settlement?._id || settle.data?._id;
    await call("POST", `/admin/settlements/${settlementId}/allocate`, { bookingReference: w5ref, amount: 80, currency: "USD" });
    await call("POST", `/admin/settlements/${settlementId}/reconcile`);
    const settlePost = await call("POST", `/admin/settlements/${settlementId}/post`);
    record("W5 OTA", "GYG payout 80 posted: Dr bank / Cr GYG receivable", ["created", "posted"].includes(settlePost.data?.action), `${settlePost.data?.action} ${short(settlePost.data?.eligibility?.blockers)}`);
    const orphan = await call("POST", "/admin/settlements", { settlementReference: "GYG-PAYOUT-LOCAL-2", provider: "GETYOURGUIDE", receivedAmount: 50, receivedCurrency: "USD", settlementDate: new Date().toISOString(), evidenceSource: "PROVIDER_STATEMENT", evidenceReference: "gyg-statement-local-2" });
    const orphanId = orphan.data?.settlement?._id || orphan.data?._id;
    await call("POST", `/admin/settlements/${orphanId}/reconcile`);
    const orphanPost = await call("POST", `/admin/settlements/${orphanId}/post`);
    record("W5 OTA", "unallocated OTA payout is not posted", orphanPost.data?.action === "blocked" && (orphanPost.data?.eligibility?.blockers || []).includes("SETTLEMENT_ALLOCATION_REQUIRED"), `${orphanPost.data?.action} ${short(orphanPost.data?.eligibility?.blockers)}`);

    // ------------------------------------------------------------------ Reconciliation across modules
    const [tb, bs] = await Promise.all(["trial-balance", "balance-sheet"].map((report) => call("GET", `/admin/accounting/${report}`)));
    const pl = (await call("GET", "/admin/accounting/profit-loss")).data;
    const ar = (await call("GET", "/admin/business-accounting/accounts-receivable")).data;
    const balances = {
      cash: await accountBalance("CASH"), bank: await accountBalance("BANK"), deposit: -(await accountBalance("CUSTOMER_DEPOSIT")),
      ar: await accountBalance("ACCOUNTS_RECEIVABLE"), gyg: await accountBalance("GYG_RECEIVABLE"), pesapal: await accountBalance("PESAPAL_CLEARING")
    };
    record("reconciliation", "trial balance balances", tb.data?.balanced === true, `Dr ${tb.data?.totals?.debit} Cr ${tb.data?.totals?.credit}`);
    record("reconciliation", "assets = liabilities + equity", bs.data?.balanced === true, short(bs.data?.totals));
    // AR keeps currencies apart (it will not add TZS to USD), so reconcile each currency to its base equivalent.
    const arUsd = (await call("GET", "/admin/business-accounting/accounts-receivable?currency=USD")).data;
    const tzsInvoice = await db.collection("invoices").findOne({ invoiceNumber: tzsNumber });
    const subledgerBase = num(arUsd.summary?.outstanding) + num(tzsInvoice.balanceDue) * 0.0004;
    record("reconciliation", "mixed-currency AR is not combined", ar.reconciliation?.status === "UNAVAILABLE" && ar.summary?.mixedCurrencies === true, short(ar.reconciliation));
    record("reconciliation", "USD AR 255 + TZS 500,000 x 0.0004 (200) = GL AR 455", near(arUsd.summary?.outstanding, 255) && near(subledgerBase, balances.ar) && near(balances.ar, 455), `usd ${arUsd.summary?.outstanding} tzs ${tzsInvoice.balanceDue} gl ${balances.ar}`);
    record("reconciliation", "cash 261 (50+46 W1, 85 W2 adjustment, 80 W4) and bank 304 (104 W1, 120 W4, 80 GYG)", near(balances.cash, 261) && near(balances.bank, 304), short(balances));
    record("reconciliation", "Pesapal clearing 255 (170+170 checkouts - 85 refund); deposits 85 (W2 decrease net)", near(balances.pesapal, 255) && near(balances.deposit, 85), short(balances));
    record("reconciliation", "GYG receivable cleared to 0", near(balances.gyg, 0), `gyg ${balances.gyg}`);
    record("reconciliation", "revenue 200+255+275+200+200+80 = 1210; refunds/allowances 20", near(pl?.totals?.revenue, 1210) && near(pl?.totals?.otherExpenses, 20), short(pl?.totals));
    const dq = (await call("GET", "/admin/data-quality/issues?limit=200")).data;
    const falseLinks = (dq?.items || []).filter((issue) => issue.code === "MISSING_PAYMENT_LINK" && String(issue.reference).startsWith("SINV-"));
    record("data quality", "standalone invoice payments are not flagged as unlinked", falseLinks.length === 0, `${falseLinks.length} false positives`);
  } catch (error) {
    record("harness", "unexpected error", false, error.stack.split("\n").slice(0, 3).join(" | "));
  } finally {
    child.kill();
    await mongoose.disconnect();
  }

  const blocked = logs.join("").match(/E2E_BLOCKED_OUTBOUND [^\n]+/g) || [];
  record("safety", "no outbound network attempts", blocked.length === 0, blocked.slice(0, 2).join("; "));
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} workflow checks passed`);
  process.exitCode = failed.length ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Deterministic local financial scenarios driven through the real API on an isolated database.
// Integrations are mocked, email is off, outbound HTTP is blocked, and posting automation is enabled ONLY
// in this local process. Usage (from backend/): npm run test:financial-local  — needs local MongoDB (replica set).
const path = require("node:path");
const { spawn } = require("node:child_process");

const backendDir = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const PORT = 5056;
const BASE = `http://127.0.0.1:${PORT}/api`;
const DB = "mongodb://127.0.0.1:27017/bokun_fin_scenarios_local";
const ADMIN = { email: "fin-admin@example.test", password: "Fin-Local-Passw0rd!" };
const ACTIVATED_AT = new Date(Date.now() - 60 * 1000).toISOString();

const ENV = {
  NODE_ENV: "development",
  PORT: String(PORT),
  MONGO_URI: DB,
  JWT_SECRET: "financial-local-only-jwt-signing-value-0123456789",
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
  // Local-only accounting automation so the full chain can be verified end to end.
  CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED: "true",
  EXPENSE_AUTOMATIC_POSTING_ENABLED: "true",
  EXPENSE_POSTING_MODE: "AUTOMATIC_NEW_EXPENSE_POSTING",
  REVENUE_RECOGNITION_AUTOMATIC_ENABLED: "true",
  REVENUE_RECOGNITION_ACTIVATED_AT: ACTIVATED_AT,
  REVENUE_RECOGNITION_ACTIVATION_SCOPE: "NEW_COMPLETIONS"
};

const results = [];
const record = (scenario, name, ok, detail = "") => {
  results.push({ scenario, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${scenario}] ${name}${detail ? `  (${detail})` : ""}`);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);
const num = (value) => Number(value?.$numberDecimal ?? value ?? 0);
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
  return { status: response.status, ok: response.ok, json, data: json?.data };
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
  const mongoose = require(path.join(backendDir, "node_modules/mongoose"));
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();
  const authService = require(path.join(backendDir, "src/services/auth"));
  await authService.registerAdmin({ firstName: "Fin", lastName: "Admin", ...ADMIN, role: "super_admin" }, null);
  const db = mongoose.connection.db;
  const { child, logs } = await startServer();

  try {
    token = (await call("POST", "/auth/login", ADMIN)).data?.token;
    record("setup", "admin login", Boolean(token));
    const chart = await call("POST", "/admin/accounting/chart-of-accounts/seed-defaults", { dryRun: false });
    const mappings = await call("POST", "/admin/accounting/mappings/seed-defaults", { dryRun: false });
    const now = new Date();
    const period = await call("POST", "/admin/accounting/periods", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
    // Revenue readiness requires OTA receivable and FX accounts that the default chart deliberately leaves to the
    // owner. These clearly-labelled LOCAL FIXTURE accounts exist only in this isolated scenario database.
    const fixtureAccounts = [
      ["1191", "LOCAL FIXTURE GYG receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "GYG_RECEIVABLE"],
      ["1192", "LOCAL FIXTURE Viator receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "VIATOR_RECEIVABLE"],
      ["1193", "LOCAL FIXTURE OTA receivable", "ASSET", "ACCOUNTS_RECEIVABLE", "OTA_RECEIVABLE"],
      ["7191", "LOCAL FIXTURE FX gain", "OTHER_INCOME", "OTHER_INCOME", "FX_GAIN"],
      ["7991", "LOCAL FIXTURE FX loss", "OTHER_EXPENSE", "OTHER_EXPENSE", "FX_LOSS"]
    ];
    for (const [code, name, type, subtype, mappingKey] of fixtureAccounts) {
      await db.collection("chartofaccounts").updateOne({ code }, { $setOnInsert: { code, name, type, subtype, active: true, allowManualPosting: false, currency: "USD", createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
      await db.collection("accountingmappings").updateOne({ mappingKey }, { $set: { mappingKey, accountCode: code, active: true, description: name } }, { upsert: true });
    }
    record("setup", "chart, mappings and open period", chart.ok && mappings.ok && period.ok, `${chart.status}/${mappings.status}/${period.status}`);

    const tours = (await call("GET", "/tours?page=1&limit=5")).data || [];
    // Expected figures assume the 2 x 85 USD dolphin tour; pick it explicitly (listing order varies).
    const pinned = tours.find((item) => item.bokunProductId === "bk_prod_znz_dolphin") || tours[0];
    const tour = (await call("GET", `/tours/${pinned.slug}`)).data;
    const option = tour.options.find((item) => item.bokunOptionId.includes("shared")) || tour.options[0];

    const book = async (label, { pay = true } = {}) => {
      const base = {
        productId: tour.bokunProductId,
        optionId: option.bokunOptionId,
        travelDate: day(20),
        pax: { adults: 2, children: 0, infants: 0 },
        priceCatalogId: String(tour.priceCatalogs[0].catalogId || tour.priceCatalogs[0].id)
      };
      // Customer checkouts are anonymous, exactly as on the public website.
      const quote = (await call("POST", "/bookings/quote", base, { anonymous: true })).data;
      const created = await call("POST", "/payments/pesapal/create", {
        ...base,
        priceCategoryParticipants: quote.priceCategoryParticipants || [],
        quoteToken: quote.quoteToken,
        customer: { firstName: "Fin", lastName: label, email: `${label.toLowerCase()}@example.test`, phone: "+255778775044", country: "TZ", hotelName: "Test Hotel" },
        bookingQuestions: [],
        paymentMethod: "pesapal",
        amount: Number(quote.pricing.finalPayable),
        currency: quote.pricing.currency
      }, { anonymous: true });
      const checkout = created.data;
      if (!pay) return { checkout, quote };
      const callback = `OrderTrackingId=${encodeURIComponent(checkout.orderTrackingId)}&OrderMerchantReference=${encodeURIComponent(checkout.merchantReference)}`;
      const success = await call("GET", `/payments/pesapal/success?${callback}`);
      const payment = await db.collection("payments").findOne({ bookingReference: checkout.bookingReference, status: "paid" });
      return { checkout, quote, success, callback, payment, reference: checkout.bookingReference };
    };

    const postPayment = (payment) => call("POST", "/admin/accounting/postings/customer-payment", { paymentId: String(payment._id) });
    const accountBalance = async (code) => {
      const tb = (await call("GET", "/admin/accounting/trial-balance")).data;
      const row = (tb.items || []).find((item) => item.accountCode === code);
      return row ? num(row.closingDebit) - num(row.closingCredit) : 0;
    };
    const mappingAccount = async (mappingKey) => (await db.collection("accountingmappings").findOne({ mappingKey }))?.accountCode;

    // S1/S5/S16: fully paid direct Pesapal booking, paid before service completion.
    const b1 = await book("Alpha");
    record("S1 direct paid booking", "checkout confirmed and paid", b1.success.data?.status === "paid", short(b1.success.data?.status));
    const inv1 = await db.collection("invoices").findOne({ bookingReference: b1.reference });
    record("S1 direct paid booking", "invoice paid, balance 0, line amounts kept", inv1.paymentStatus === "paid" && near(inv1.balanceDue, 0) && inv1.items.every((item) => item.total !== undefined && item.total !== null), `total ${inv1.total} paid ${inv1.amountPaid}`);
    const post1 = await postPayment(b1.payment);
    record("S16 payment before completion", "prepayment posts to Customer Deposit", post1.data?.eligibility?.treatment === "CUSTOMER_DEPOSIT" && ["created", "posted"].includes(post1.data?.action), `${post1.data?.action} ${short(post1.data?.eligibility?.blockers)}`);

    // S12: duplicate payment callback and duplicate posting.
    await call("GET", `/payments/pesapal/success?${b1.callback}`);
    await call("GET", `/payments/pesapal/ipn?${b1.callback}&OrderNotificationType=IPNCHANGE`);
    const paymentCount = await db.collection("payments").countDocuments({ bookingReference: b1.reference, status: "paid" });
    const repost = await postPayment(b1.payment);
    const paymentJournals = await db.collection("journalentries").countDocuments({ "source.postingKey": `customer-payment:${b1.payment._id}:v1` });
    record("S12 duplicate callback", "one payment, one journal after replays", paymentCount === 1 && paymentJournals === 1 && ["existing", "blocked"].includes(repost.data?.action), `payments ${paymentCount}, journals ${paymentJournals}, repost ${repost.data?.action}`);

    // S7: multiple supplier expenses on one booking, posted to Accounts Payable.
    const expense = async (reference, category, amount, extra = {}) => {
      const created = await call("POST", "/admin/booking-accounting/expenses", {
        bookingReference: reference, category, description: `${category} for ${reference}`, amount, currency: "USD",
        expenseDate: new Date().toISOString(), idempotencyKey: `${reference}-${category}-${amount}`, status: "APPROVED",
        completionStatus: "COMPLETE", supplier: { name: `${category} supplier` }, ...extra
      });
      const id = created.data?._id || created.data?.id || created.data?.expense?._id || created.data?.expense?.id;
      const posted = id ? await call("POST", `/admin/business-expenses/${id}/post`) : null;
      return { created, id, posted };
    };
    const e1 = await expense(b1.reference, "DIRECT_GUIDE_COST", 30);
    const e2 = await expense(b1.reference, "DIRECT_BOAT_COST", 50);
    record("S7 multiple supplier expenses", "two expenses created and posted", Boolean(e1.id && e2.id) && [e1, e2].every((item) => item.posted?.ok), `${e1.created.status}/${e2.created.status} post ${e1.posted?.status}/${e2.posted?.status} ${short(e1.posted?.data?.action || e1.posted?.json?.message || e1.created.json?.message)}`);

    // S8: booking with no actual cost evidence; S14: multi-currency cost.
    const b2 = await book("Bravo");
    await postPayment(b2.payment);
    const fx = await expense(b2.reference, "DIRECT_TRANSPORT_COST", 26000, { currency: "TZS", exchangeRate: 0.0004, exchangeRateDate: new Date().toISOString(), exchangeRateSource: "Local test fixture rate", idempotencyKey: `${b2.reference}-tzs` });
    const fxRow = fx.id ? await db.collection("businessexpenses").findOne({ _id: new mongoose.Types.ObjectId(fx.id) }) : null;
    record("S14 multi-currency cost", "TZS cost converted with recorded rate", fxRow && near(fxRow.baseCurrencyAmount, 10.4) && fx.posted?.ok, `base ${num(fxRow?.baseCurrencyAmount)} ${fxRow?.baseCurrency} post ${fx.posted?.status} ${short(fx.posted?.json?.message)}`);

    // Service completion -> revenue recognition releases the deposit (S16 continued).
    await db.collection("bookings").updateOne({ bookingReference: b1.reference }, { $set: { "bokunOperationalEvidence.activityStatus": "ARRIVED" } });
    const completion = await call("POST", "/admin/service-completions", {
      bookingReference: b1.reference, serviceKey: tour.bokunProductId, status: "COMPLETED", evidenceSource: "ADMIN_CONFIRMATION",
      completedAt: new Date().toISOString(), reason: "Local scenario: guest arrived (fixture evidence)"
    });
    const recognition = await db.collection("revenuerecognitions").findOne({ bookingReference: b1.reference });
    record("S16 payment before completion", "completion recognizes revenue from the deposit", completion.ok && recognition?.status === "POSTED", `${completion.status} ${recognition?.status} ${short(recognition?.blockers || completion.data?.accounting || completion.json?.message)}`);

    // S9/S11: cancellation with full refund before service.
    const refundFlow = async (booking, refundAmount, confirmedAmount) => {
      const request = await call("POST", `/bookings/${booking.checkout.bookingId}/requests`, {
        customerEmail: `${booking.label}@example.test`, type: "cancel_booking", customerReason: "Local scenario cancellation",
        cancellationReason: "change_of_plans", cancellationConfirmed: true
      });
      const requestId = request.data?.id || request.data?._id || request.data?.request?._id;
      const approve = await call("POST", `/admin/booking-requests/${requestId}/approve`, {
        customerFacingReason: "Approved", refundProvider: "pesapal", refundReason: "Customer cancellation", refundAmount
      });
      const refundId = approve.data?.refund?._id;
      const requestedRefund = refundId ? await db.collection("refunds").findOne({ _id: new mongoose.Types.ObjectId(refundId) }) : null;
      const prematurePost = refundId ? await call("POST", "/admin/accounting/postings/customer-refund", { refundId }) : null;
      const process = refundId ? await call("POST", `/admin/refunds/${refundId}/process`, { confirm: true }) : null;
      const confirm = refundId ? await call("POST", `/admin/refunds/${refundId}/status`, {
        status: confirmedAmount >= refundAmount ? "refunded" : "partially_refunded",
        providerRefundReference: `PESAPAL-RF-${booking.reference}`, confirmedAmount, evidenceNote: "Local scenario provider confirmation fixture"
      }) : null;
      const post = refundId ? await call("POST", "/admin/accounting/postings/customer-refund", { refundId }) : null;
      return { request, approve, refundId, requestedRefund, prematurePost, process, confirm, post };
    };
    const b3 = await book("Charlie");
    b3.label = "charlie";
    await postPayment(b3.payment);
    const r3 = await refundFlow(b3, 170, 170);
    record("S10/S11 refunds", "refund request is not posted as cash", r3.prematurePost?.data?.eligibility?.blockers?.includes("REFUND_NOT_COMPLETED"), short(r3.prematurePost?.data?.eligibility?.blockers));
    record("S9/S11 cancellation + full refund", "confirmed refund posts against the deposit", r3.post?.data?.eligibility?.debitMappingKey === "CUSTOMER_DEPOSIT" && ["created", "posted"].includes(r3.post?.data?.action), `${r3.approve.status} ${short(r3.approve.json?.message || r3.approve.json?.error)} req ${short(r3.request.data && Object.keys(r3.request.data))} ${short(r3.approve.json?.error?.details)} confirm ${r3.confirm?.status} ${short(r3.confirm?.json?.message)} post ${r3.post?.data?.action} ${short(r3.post?.data?.eligibility?.blockers)}`);
    const inv3 = await db.collection("invoices").findOne({ bookingReference: b3.reference });
    record("S9 cancellation", "cancelled invoice carries no balance", near(inv3.balanceDue, 0), `balanceDue ${inv3.balanceDue} refunded ${inv3.amountRefunded}`);

    // S10: partial refund (retained amount stays a deposit until a cancellation-fee policy is applied).
    const b4 = await book("Delta");
    b4.label = "delta";
    await postPayment(b4.payment);
    const r4 = await refundFlow(b4, 50, 50);
    record("S10 partial refund", "partial refund of 50 posted", ["created", "posted"].includes(r4.post?.data?.action), `${r4.approve.status} ${r4.confirm?.status} ${short(r4.confirm?.json?.message)} post ${r4.post?.data?.action} ${short(r4.post?.data?.eligibility?.blockers)}`);

    // S3: abandoned (unpaid) checkout is not a sale and not a receivable.
    const b5 = await book("Echo", { pay: false });

    // S18: Pesapal payout settlement for B1 (165 net after a 5 fee) -> bank.
    const settlement = await call("POST", "/admin/settlements", {
      settlementReference: "PSP-PAYOUT-LOCAL-1", provider: "PESAPAL", grossAmount: 170, grossCurrency: "USD", feesAmount: 5, feesCurrency: "USD",
      receivedAmount: 165, receivedCurrency: "USD", settlementDate: new Date().toISOString(), receivedVia: "PROVIDER_PAYOUT",
      evidenceSource: "PROVIDER_STATEMENT", evidenceReference: "local-statement-1"
    });
    const settlementId = settlement.data?.settlement?._id || settlement.data?._id;
    await call("POST", `/admin/settlements/${settlementId}/allocate`, { bookingReference: b1.reference, amount: 165, currency: "USD" });
    const reconciled = await call("POST", `/admin/settlements/${settlementId}/reconcile`);
    const settlementPost = await call("POST", `/admin/settlements/${settlementId}/post`);
    record("S18 settlement reconciliation", "reconciled payout posted to bank", ["created", "posted"].includes(settlementPost.data?.action), `${settlement.status} reconcile ${reconciled.data?.status} post ${settlementPost.data?.action} ${short(settlementPost.data?.eligibility?.blockers)}`);
    const settlementRepost = await call("POST", `/admin/settlements/${settlementId}/post`);
    record("S18 settlement reconciliation", "settlement posting is idempotent", settlementRepost.data?.action === "existing", settlementRepost.data?.action);

    // S20: statements and cross-module consistency.
    const [tb, bs, pl, cf] = await Promise.all(["trial-balance", "balance-sheet", "profit-loss", "cash-flow"].map((report) => call("GET", `/admin/accounting/${report}`)));
    record("S20 statements", "trial balance balances", tb.data?.balanced === true, `Dr ${tb.data?.totals?.debit} Cr ${tb.data?.totals?.credit}`);
    record("S20 statements", "assets = liabilities + equity", bs.data?.balanced === true, short(bs.data?.totals));
    const clearing = await accountBalance(await mappingAccount("PESAPAL_CLEARING"));
    const deposits = -(await accountBalance(await mappingAccount("CUSTOMER_DEPOSIT")));
    const bank = await accountBalance(await mappingAccount("BANK"));
    const revenue = num(pl.data?.totals?.revenue);
    const costs = Number(num(pl.data?.totals?.costOfSales).toFixed(2));
    record("S20 statements", "Pesapal clearing = 290 (4x170 - 170 settled - 170 - 50 refunded)", near(clearing, 290), `clearing ${clearing}`);
    record("S20 statements", "customer deposits = 290 (680 - 170 recognized - 220 refunded)", near(deposits, 290), `deposits ${deposits}`);
    record("S20 statements", "bank = 165 net payout", near(bank, 165), `bank ${bank}`);
    record("S20 statements", "revenue = 170 recognized for the completed service only", near(revenue, 170), `revenue ${revenue}`);
    record("S20 statements", "direct costs = 80 + 10.40 (TZS at 0.0004)", near(costs, 90.4), `cost of sales ${costs}`);
    record("S20 statements", "cash flow shows the 165 payout", near(cf.data?.totals?.netCashFlow, 165), short(cf.data?.totals));

    const dash = (await call("GET", "/admin/booking-accounting/dashboard")).data?.totals || {};
    const prof = (await call("GET", "/admin/booking-accounting/profitability?limit=50")).data;
    const ar = (await call("GET", "/admin/business-accounting/accounts-receivable")).data;
    const ap = (await call("GET", "/admin/business-accounting/accounts-payable")).data;
    record("S3 unpaid checkout", "abandoned checkout and cancellations excluded from booking revenue", near(dash.bookingRevenue, 340), `bookingRevenue ${dash.bookingRevenue} (B1+B2 = 340)`);
    record("cross-module", "dashboard and profitability gross profit agree", near(dash.dashboardGrossProfit, prof.totals.dashboardGrossProfit), `${dash.dashboardGrossProfit} vs ${prof.totals.dashboardGrossProfit}`);
    const p1 = prof.items.find((item) => item.bookingReference === b1.reference);
    record("S7 multiple supplier expenses", "B1 actual cost 80, gross profit 90", p1 && near(p1.actualDirectCost, 80) && near(p1.dashboardGrossProfit, 90), short(p1 && { cost: p1.actualDirectCost, gp: p1.dashboardGrossProfit, status: p1.costStatus }));
    const p5 = prof.items.find((item) => item.bookingReference === b5.checkout.bookingReference);
    record("S3 unpaid checkout", "abandoned checkout has no revenue or cost", !p5 || (p5.isSale === false && p5.bookedRevenue === 0), short(p5 && { isSale: p5.isSale, revenue: p5.bookedRevenue }));
    record("cross-module", "AR sub-ledger reconciles with GL", ar.reconciliation?.status === "RECONCILED", short(ar.reconciliation));
    record("cross-module", "AP sub-ledger reconciles with GL", ap.reconciliation?.status === "RECONCILED", short(ap.reconciliation));
    record("S4 outstanding", "no customer balance outstanding (all prepaid)", near(dash.outstandingAmount, 0) && near(ar.summary?.outstanding, 0), `dash ${dash.outstandingAmount} ar ${ar.summary?.outstanding}`);

    // Business Intelligence reads management contribution postings; before they exist it must disclose the gap.
    const biBefore = (await call("GET", "/admin/analytics/business-intelligence")).data;
    record("BI", "discloses confirmed bookings without contribution postings", (biBefore?.warnings || []).some((item) => item.code === "MISSING_ACCOUNTING_POSTINGS" && item.count === 2), short(biBefore?.warnings));
    const contributions = [];
    for (const booking of [b1, b2]) {
      // Two-step approval: preview to obtain the authoritative posting key, then confirm with it.
      const preview = await call("POST", `/admin/business-accounting/postings/bookings/${booking.reference}`, { dryRun: true });
      const key = preview.data?.idempotencyKey || preview.data?.posting?.idempotencyKey || preview.data?.payload?.idempotencyKey;
      contributions.push(await call("POST", `/admin/business-accounting/postings/bookings/${booking.reference}`, { dryRun: false, approvalId: `LOCAL-APPROVAL-${booking.reference}`, reason: "Local scenario approval", idempotencyKey: key }));
    }
    const biAfter = (await call("GET", "/admin/analytics/business-intelligence")).data;
    record("BI", "booked revenue reconciles with Booking Accounting after posting", near(biAfter?.financialSummary?.bookedRevenue, dash.bookingRevenue), `BI ${biAfter?.financialSummary?.bookedRevenue} vs dashboard ${dash.bookingRevenue}; posts ${contributions.map((item) => item.status + ":" + (item.data?.action || item.data?.status || item.json?.message) + ":" + short(item.data?.posting?.blockers || item.data?.blockers || item.data?.reasons)).join(" | ")}`);

    // S19: an accountant reviews the period payments, closes the period, and later postings are refused.
    for (const booking of [b1, b2, b3, b4]) {
      await call("POST", `/payments/reconciliation/${booking.reference}/mark-reviewed`, { reviewNote: "Local scenario month-end review" });
    }
    const periods = (await call("GET", "/admin/accounting/periods")).data;
    const open = (periods?.items || periods || []).find((item) => item.status === "OPEN");
    const close = open ? await call("POST", `/admin/accounting/periods/${open._id || open.id}/close`, { reason: "Local scenario period close" }) : null;
    const lateExpense = await expense(b2.reference, "DIRECT_ACTIVITY_COST", 5, { idempotencyKey: `${b2.reference}-late` });
    record("S19 period close", "period closes once payments are reviewed and expenses posted", Boolean(close?.ok), `${close?.status} ${short(close?.data?.status || close?.json?.message || close?.json?.error)}`);
    {
      record("S19 period close", "posting into a closed period is refused", !lateExpense.posted?.ok || lateExpense.posted?.data?.action !== "posted", `${lateExpense.posted?.status} ${short(lateExpense.posted?.json?.message || lateExpense.posted?.data)}`);
    }
  } catch (error) {
    record("harness", "unexpected error", false, error.stack.split("\n").slice(0, 3).join(" | "));
  } finally {
    child.kill();
    await mongoose.disconnect();
  }

  const blocked = logs.join("").match(/E2E_BLOCKED_OUTBOUND [^\n]+/g) || [];
  record("safety", "no outbound network attempts", blocked.length === 0, blocked.slice(0, 2).join("; "));
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} financial checks passed`);
  process.exitCode = failed.length ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

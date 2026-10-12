const path = require("node:path");
const crypto = require("node:crypto");

const short = (value) => JSON.stringify(value ?? null).slice(0, 260);

module.exports = async ({ call, record, ctx, ADMIN, backendDir }) => {
  const token = ctx.token;
  const ref = ctx.payment?.bookingReference;
  const bookingId = ctx.payment?.bookingId;

  // Booking + invoice + accounting reads. A reference alone must never open them; the checkout
  // response carries the customer's access token.
  const accessHeaders = { "X-Booking-Access-Token": ctx.payment?.bookingAccessToken || "" };
  const anonymousBooking = await call("GET", `/bookings/${ref}`);
  record("booking reference alone is refused", anonymousBooking.status === 404, `status ${anonymousBooking.status}`);
  const anonymousInvoice = await call("GET", `/invoices/booking/${ref}`);
  record("invoice by reference alone is refused", anonymousInvoice.status === 404, `status ${anonymousInvoice.status}`);
  const booking = await call("GET", `/bookings/${ref}`, { headers: accessHeaders });
  record("customer booking lookup with access token", booking.ok, `status ${booking.status}`);
  const invoice = await call("GET", `/invoices/booking/${ref}`, { headers: accessHeaders });
  const items = invoice.json?.data?.items || invoice.json?.data?.invoice?.items || [];
  record("invoice by booking reference", invoice.ok, `status ${invoice.status}, ${items.length} items`);
  record(
    "invoice line items carry amounts",
    items.length > 0 && items.every((item) => Number.isFinite(Number(item.total)) && item.total !== null && item.total !== undefined),
    short(items.map((item) => ({ label: item.label, quantity: item.quantity, unitPrice: item.unitPrice, total: item.total })))
  );

  const adminReads = [
    "/reports/dashboard-summary",
    "/admin/production-readiness/summary",
    "/admin/system-health/summary",
    "/admin/data-quality/summary",
    "/admin/ops-control/summary",
    "/admin/disaster-recovery/summary",
    "/admin/performance-review/summary",
    "/admin/audit-control/summary",
    "/payments",
    "/payments/reconciliation",
    "/admin/booking-accounting/dashboard",
    "/admin/business-accounting/accounts-receivable",
    "/admin/report-center/summary"
  ];
  for (const url of adminReads) {
    const response = await call("GET", url, { token });
    record(`admin GET ${url}`, response.ok, `status ${response.status}, ${response.ms}ms${response.ok ? "" : ` ${short(response.json?.message)}`}`);
    if (url.endsWith("production-readiness/summary") && response.ok) ctx.readiness = response.json.data;
  }

  // Refund: customer cancellation request -> admin approve -> Pesapal mock refund -> verify
  const cancelRequest = await call("POST", `/bookings/${bookingId}/requests`, {
    body: {
      customerEmail: "guest@example.test",
      type: "cancel_booking",
      customerReason: "Local E2E cancellation test",
      cancellationReason: "change_of_plans",
      cancellationConfirmed: true
    }
  });
  const requestId = cancelRequest.json?.data?.request?._id || cancelRequest.json?.data?._id || cancelRequest.json?.data?.id;
  record("customer cancellation request", cancelRequest.ok && Boolean(requestId), `status ${cancelRequest.status} ${cancelRequest.ok ? "" : short(cancelRequest.json)}`);
  if (requestId) {
    const approve = await call("POST", `/admin/booking-requests/${requestId}/approve`, {
      token,
      body: { customerFacingReason: "Approved in local E2E", refundProvider: "pesapal", refundReason: "Customer cancellation", refundAmount: Number(ctx.quote?.pricing?.finalPayable || 0) }
    });
    const refundId = approve.json?.data?.refund?._id || approve.json?.data?.request?.refund?.refundId || approve.json?.data?.refundId;
    record("admin approves cancellation", approve.ok, `status ${approve.status} refund ${refundId || "none"} ${approve.ok ? "" : short(approve.json)}`);
    if (refundId) {
      const process = await call("POST", `/admin/refunds/${refundId}/process`, { token, body: { confirm: true } });
      record("refund processed via Pesapal (mock)", process.ok, `status ${process.status} ${short(process.json?.data?.refund?.status || process.json?.message)}`);
      const verify = await call("POST", `/admin/refunds/${refundId}/verify`, { token, body: {} });
      record("refund verification", verify.ok, `status ${verify.status} ${short(verify.json?.data?.refund?.status || verify.json?.data?.status || verify.json?.message)}`);
      const again = await call("POST", `/admin/refunds/${refundId}/process`, { token, body: { confirm: true } });
      const m = require(path.join(backendDir, "node_modules/mongoose"));
      await m.connect(ctx.mongoUri || "mongodb://127.0.0.1:27017/bokun_e2e_local");
      const refunds = await m.connection.db.collection("refunds").find({}).toArray();
      await m.disconnect();
      record("refund double-submit is idempotent", refunds.length === 1 && new Set(refunds.map((r) => r.providerRefundRequestReference)).size === 1, `second call status ${again.status}, refunds ${refunds.length}, msg ${short(again.json?.message)}`);
      ctx.refundStatus = verify.json?.data?.refund?.status || verify.json?.data?.status;
    }
  }

  // Password recovery (email disabled locally: the token is planted the way the emailed link would carry it)
  const forgot = await call("POST", "/auth/forgot-password", { body: { email: ADMIN.email } });
  record("forgot-password unavailable without email (no token issued)", forgot.status === 503, `status ${forgot.status}`);
  const mongoose = require(path.join(backendDir, "node_modules/mongoose"));
  const resetToken = crypto.randomBytes(32).toString("hex");
  // The harness database: the shared local scratch DB or the isolated mongod (--isolated-mongo).
  await mongoose.connect(ctx.mongoUri || "mongodb://127.0.0.1:27017/bokun_e2e_local");
  await mongoose.connection.db.collection("users").updateOne({ email: ADMIN.email }, {
    $set: {
      passwordResetHash: crypto.createHash("sha256").update(resetToken).digest("hex"),
      passwordResetExpiresAt: new Date(Date.now() + 10 * 60000)
    }
  });
  await mongoose.disconnect();
  const newPassword = "E2e-Rotated-Passw0rd!";
  const reset = await call("POST", "/auth/reset-password", { body: { token: resetToken, password: newPassword } });
  record("password reset with valid token", reset.ok, `status ${reset.status}`);
  const reuse = await call("POST", "/auth/reset-password", { body: { token: resetToken, password: "Another-Passw0rd-1!" } });
  record("reset token cannot be reused", reuse.status === 400, `status ${reuse.status}`);
  const oldSession = await call("GET", "/auth/me", { token });
  record("existing session revoked after reset", oldSession.status === 401, `status ${oldSession.status}`);
  const oldLogin = await call("POST", "/auth/login", { body: ADMIN });
  record("old password rejected after reset", oldLogin.status === 401, `status ${oldLogin.status}`);
  const newLogin = await call("POST", "/auth/login", { body: { email: ADMIN.email, password: newPassword } });
  record("new password works", newLogin.ok, `status ${newLogin.status}`);
  ctx.token = newLogin.json?.data?.token;

  // Error handling and authorization
  const unknown = await call("GET", "/definitely-not-a-route");
  record("unknown route returns 404 JSON", unknown.status === 404 && unknown.json?.success === false, `status ${unknown.status}`);
  const invalid = await call("POST", "/bookings/quote", { body: { productId: "x" } });
  record("invalid payload rejected (422 validation)", invalid.status === 422 && invalid.json?.success === false, `status ${invalid.status}`);
  const anonymous = await call("GET", "/admin/production-readiness/summary");
  record("admin endpoint requires auth", anonymous.status === 401, `status ${anonymous.status}`);
  const forged = await call("GET", "/auth/me", { token: "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IngifQ.invalid" });
  record("forged token rejected", forged.status === 401, `status ${forged.status}`);
  const missingBooking = await call("GET", "/bookings/ZNZ-DOES-NOT-EXIST");
  record("missing booking returns 404", missingBooking.status === 404, `status ${missingBooking.status}`);
  const leak = JSON.stringify([unknown.json, invalid.json, anonymous.json, forged.json, missingBooking.json]);
  record("error responses carry no stack traces", !/at\s+\S+\s+\(|node_modules|\.js:\d+/.test(leak));
};

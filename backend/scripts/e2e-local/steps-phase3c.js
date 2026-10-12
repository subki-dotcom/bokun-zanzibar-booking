// Phase 3C workflow: a website booking (created by steps-booking.js) is seen by Tour Admin, the customer
// submits a request, Tour Admin escalates it to Finance, Finance reviews it in the escalation queue, and
// nothing about the booking, its invoice, payments or accounting changes because of that handoff.
const path = require("node:path");

const PASSWORD = "E2e-Local-Phase3c-Passw0rd!";

const snapshotFor = async ({ backendDir, mongoUri, bookingReference }) => {
  const mongoose = require(path.join(backendDir, "node_modules/mongoose"));
  const connection = await mongoose.createConnection(mongoUri, { autoIndex: false, autoCreate: false }).asPromise();
  try {
    const db = connection.db;
    const counts = {};
    for (const name of ["bookings", "invoices", "payments", "paymentallocations", "journalentries", "accountingpostings", "refunds", "commissionrecords", "bookingrequests"]) {
      counts[name] = await db.collection(name).countDocuments({});
    }
    const documents = JSON.stringify({
      booking: await db.collection("bookings").findOne({ bookingReference }),
      invoices: await db.collection("invoices").find({ bookingReference }).sort({ _id: 1 }).toArray(),
      payments: await db.collection("payments").find({ bookingReference }).sort({ _id: 1 }).toArray()
    });
    const booking = await db.collection("bookings").findOne({ bookingReference }, { projection: { bookingOrigin: 1, operationalSource: 1, createdByRole: 1 } });
    return { counts, documents, booking };
  } finally {
    await connection.close();
  }
};

module.exports = async ({ call, record, ctx, backendDir }) => {
  const reference = ctx.payment?.bookingReference;
  const bookingId = ctx.payment?.bookingId;
  if (!reference || !bookingId) {
    record("phase 3C: website booking available", false, "no booking from checkout");
    return;
  }
  const admin = ctx.token;

  // Accounts: a Tour Admin, a Finance (staff) user and an approved Agent.
  const createUser = async (role) => {
    const email = `e2e-${role}@example.test`;
    const created = await call("POST", "/auth/register-admin", { token: admin, body: { firstName: "E2E", lastName: role, email, password: PASSWORD, role } });
    const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    record(`phase 3C: ${role} account`, created.ok && login.ok, `create ${created.status}, login ${login.status}`);
    return login.json?.data?.token;
  };
  const tour = await createUser("tour_admin");
  const finance = await createUser("staff");
  const agentEmail = "e2e-agent@example.test";
  await call("POST", "/auth/register-agent", { body: { companyName: "E2E Agency", contactFirstName: "Agent", contactLastName: "Tester", email: agentEmail, password: PASSWORD } });
  const agents = await call("GET", "/agents", { token: admin });
  const agentRow = (agents.json?.data?.items || agents.json?.data || []).find((row) => row.email === agentEmail);
  if (agentRow) await call("POST", `/agents/${agentRow._id || agentRow.id}/update-status`, { token: admin, body: { approvalStatus: "approved", isActive: true } });
  const agentLogin = await call("POST", "/auth/login", { body: { email: agentEmail, password: PASSWORD, portal: "agent" } });
  const agent = agentLogin.json?.data?.token;
  record("phase 3C: agent account", Boolean(agent), `login ${agentLogin.status}`);

  // 4-5. Origin stays WEBSITE after Bókun finalization; Tour Admin sees the booking.
  const before = await snapshotFor({ backendDir, mongoUri: ctx.mongoUri, bookingReference: reference });
  record("phase 3C: booking origin WEBSITE after Bókun finalization", before.booking?.bookingOrigin === "WEBSITE",
    `origin ${before.booking?.bookingOrigin}, operationalSource ${before.booking?.operationalSource}`);
  const tourList = await call("GET", `/tour-operations/bookings?search=${encodeURIComponent(reference)}`, { token: tour });
  const tourItem = tourList.json?.data?.items?.[0];
  record("phase 3C: Tour Admin sees the website booking", tourList.ok && tourItem?.bookingReference === reference && tourItem?.origin === "WEBSITE",
    `status ${tourList.status}, origin ${tourItem?.origin}, payment ${tourItem?.status?.payment}, supplier ${tourItem?.status?.supplier}`);

  // 6. The customer submits an operational request (customer endpoint, booking email as proof). A date
  // change, so the cancellation flow in steps-admin.js can still open its own cancellation request.
  const newDate = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const submitted = await call("POST", `/bookings/${bookingId}/requests`, {
    body: { customerEmail: "guest@example.test", type: "reschedule", requestedChanges: { date: newDate }, customerReason: "Our flight was moved; we need a later date" }
  });
  record("phase 3C: customer submits a date-change request", submitted.status === 201, `status ${submitted.status} ${submitted.ok ? "" : JSON.stringify(submitted.json).slice(0, 200)}`);

  const afterSubmission = await snapshotFor({ backendDir, mongoUri: ctx.mongoUri, bookingReference: reference });

  // 7. Tour Admin reviews and escalates to Finance.
  const requests = await call("GET", `/tour-operations/requests?bookingReference=${encodeURIComponent(reference)}`, { token: tour });
  const requestId = requests.json?.data?.items?.[0]?.id;
  record("phase 3C: Tour Admin sees the request", requests.ok && Boolean(requestId), `status ${requests.status}, ${requests.json?.data?.total} request(s)`);
  const review = await call("POST", `/tour-operations/requests/${requestId}/transition`, { token: tour, body: { toState: "UNDER_REVIEW", expectedVersion: 0 } });
  const escalate = await call("POST", `/tour-operations/requests/${requestId}/transition`, { token: tour, body: { toState: "AWAITING_FINANCE", expectedVersion: 1, reason: "Price difference decision needed for the new date" } });
  record("phase 3C: Tour Admin escalates to Finance", review.ok && escalate.ok && escalate.json?.data?.operations?.state === "AWAITING_FINANCE",
    `review ${review.status}, escalate ${escalate.status}`);

  // 8-9. Finance sees and inspects the same request, read-only.
  const queue = await call("GET", "/admin/finance/escalations", { token: finance });
  const queued = (queue.json?.data?.items || []).find((item) => item.id === requestId);
  record("phase 3C: Finance sees the escalation in the queue", queue.ok && queued?.booking?.bookingReference === reference && queued?.escalation?.reason === "Price difference decision needed for the new date",
    `status ${queue.status}, escalated at ${queued?.escalation?.at}`);
  const detail = await call("GET", `/admin/finance/escalations/${requestId}`, { token: finance });
  const detailText = JSON.stringify(detail.json || {});
  record("phase 3C: Finance inspects the request without provider payloads", detail.ok && detail.json?.data?.request?.customerReason === "Our flight was moved; we need a later date" &&
    !/requestPayload|responseSnapshot|providerResolution|providerRefundReference/.test(detailText), `status ${detail.status}`);
  const financeTransition = await call("POST", `/tour-operations/requests/${requestId}/transition`, { token: finance, body: { toState: "RESOLVED", expectedVersion: 2 } });
  const financeWrite = await call("POST", `/admin/finance/escalations/${requestId}`, { token: finance, body: {} });
  record("phase 3C: Finance reading the queue gains no workflow writes", financeTransition.status === 403 && !financeWrite.ok,
    `tour transition ${financeTransition.status}, queue POST ${financeWrite.status}`);

  // 10. Tour Admin, agents and customer proof cannot reach Finance routes.
  const tourFinance = await call("GET", "/admin/finance/escalations", { token: tour });
  const tourAccounting = await call("GET", "/admin/booking-accounting/dashboard", { token: tour });
  const agentFinance = await call("GET", "/admin/finance/escalations", { token: agent });
  const customerFinance = await call("GET", "/admin/finance/escalations", { headers: { "X-Booking-Access-Token": ctx.payment?.bookingAccessToken || "" } });
  record("phase 3C: Finance queue refuses Tour Admin, Agent and customer tokens",
    tourFinance.status === 403 && tourAccounting.status === 403 && agentFinance.status === 403 && customerFinance.status === 401,
    `tour ${tourFinance.status}/${tourAccounting.status}, agent ${agentFinance.status}, customer ${customerFinance.status}`);

  // 11-12. No duplicate booking, invoice or payment; no accounting change from the handoff.
  const after = await snapshotFor({ backendDir, mongoUri: ctx.mongoUri, bookingReference: reference });
  const changedCounts = Object.keys(after.counts).filter((name) => after.counts[name] !== afterSubmission.counts[name]);
  record("phase 3C: escalation and Finance review change no booking, invoice, payment or accounting record",
    after.documents === afterSubmission.documents && changedCounts.length === 0,
    `changed collections: ${changedCounts.join(",") || "none"}`);
  record("phase 3C: one booking, invoice and payment set for the reference (no duplicates)",
    after.counts.bookings === before.counts.bookings && JSON.parse(after.documents).invoices.length <= 1,
    `bookings ${after.counts.bookings}, invoices for ref ${JSON.parse(after.documents).invoices.length}, payments for ref ${JSON.parse(after.documents).payments.length}`);

  // 13. Agent ownership: an Agent cannot open a website booking or its invoice.
  const agentBooking = await call("GET", `/agent/bookings/${reference}`, { token: agent });
  const agentLookup = await call("GET", `/bookings/${reference}`, { token: agent });
  record("phase 3C: Agent ownership enforced on the website booking", agentBooking.status === 404 && agentLookup.status === 404,
    `agent portal ${agentBooking.status}, lookup ${agentLookup.status}`);

  // 14. Transfer Admin is separate: Back Office sessions are not Transfer Admin sessions.
  const transferWithTour = await call("GET", "/transfer-admin/zones", { token: tour });
  const transferWithAdmin = await call("GET", "/transfer-admin/zones", { token: admin });
  record("phase 3C: Transfer Admin unaffected and not reachable with Back Office sessions",
    [401, 403, 503].includes(transferWithTour.status) && [401, 403, 503].includes(transferWithAdmin.status),
    `tour ${transferWithTour.status}, super admin ${transferWithAdmin.status}`);
};

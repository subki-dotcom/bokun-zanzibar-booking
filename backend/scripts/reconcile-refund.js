require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const BookingRequest = require("../src/models/BookingRequest");
const Invoice = require("../src/models/Invoice");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const AuditLog = require("../src/models/AuditLog");
const refundsService = require("../src/services/refunds");
const pesapalService = require("../src/services/payments/pesapal");
const { decimalOrNull, normalizeCurrency } = require("../src/utils/money");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith("--"))
    .map((argument) => {
      const [key, ...rest] = argument.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : "true"];
    })
);

const bookingReference = String(args["booking-reference"] || "").trim();
const dryRun = args["dry-run"] !== "false" && args.apply !== "true";
const apply = args.apply === "true";
const manualProviderConfirmed = args["manual-provider-confirmed"] === "true" || args["provider-confirmed"] === "true";
const providerRefundReference = String(args["provider-refund-reference"] || "").trim();
const evidenceNote = String(args["evidence-note"] || "").trim();
const adminActor = String(args["admin-actor"] || "").trim();
const evidenceAmount = args.amount === undefined ? null : Number(args.amount);
const evidenceCurrency = normalizeCurrency(args.currency || "");
const evidenceProvider = refundsService.normalizeProvider(args.provider || "");
const refundedAt = args["refunded-at"] ? new Date(args["refunded-at"]) : new Date();
const markCancelled = args["mark-cancelled"] !== "false";

const maskReference = refundsService.maskReference;
const number = (value = 0) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const asId = (value) => (value ? String(value) : "");
const requestReference = () => `BRQ-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const refundReference = () => `RFD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const FINAL_REFUND_STATUSES = new Set(["refunded", "partially_refunded"]);

const pickPayment = (payments = []) =>
  payments.find((payment) => String(payment.status || "").toLowerCase() === "paid") || payments[0] || null;

const resolveLocalRefundAmount = ({ existingRefund, invoice, payment, booking }) =>
  number(existingRefund?.amount) ||
  number(evidenceAmount) ||
  number(invoice?.amountPaid) ||
  number(payment?.amountPaid || payment?.paidAmount || payment?.amount) ||
  number(booking?.amount || booking?.invoiceSnapshot?.amountPaid);

const resolveLocalRefundCurrency = ({ existingRefund, invoice, payment, booking }) =>
  normalizeCurrency(
    existingRefund?.accountingRefundCurrency ||
      existingRefund?.currency ||
      evidenceCurrency ||
      invoice?.accountingCurrency ||
      payment?.accountingCurrency ||
      payment?.currency ||
      booking?.currency ||
      "USD"
  );

const resolvePesapalOrderTrackingId = ({ booking, payment, refund }) =>
  refundsService.__testables.extractPesapalOrderTrackingId({ booking, payment, refund });

const getPesapalEvidence = async ({ booking, payment, refund }) => {
  const orderTrackingId = resolvePesapalOrderTrackingId({ booking, payment, refund });
  if (!orderTrackingId) {
    return {
      available: false,
      error: { code: "PESAPAL_ORDER_TRACKING_MISSING", message: "Pesapal orderTrackingId is missing from local records." }
    };
  }
  try {
    const verification = await pesapalService.getTransactionStatus({
      orderTrackingId,
      booking,
      orderMerchantReference: payment?.merchantReference || booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference,
      requestId: `reconcile-refund-${Date.now()}`
    });
    return { available: true, orderTrackingId, verification };
  } catch (error) {
    return {
      available: false,
      orderTrackingId,
      error: {
        code: error.code || "PESAPAL_STATUS_LOOKUP_FAILED",
        message: error.message
      }
    };
  }
};

const buildVirtualRefund = ({ booking, payment, existingRefund, amount, currency, providerRefundRequestReference = "" }) => ({
  _id: existingRefund?._id || null,
  amount,
  currency,
  accountingRefundAmount: existingRefund?.accountingRefundAmount || decimalOrNull(amount),
  accountingRefundCurrency: existingRefund?.accountingRefundCurrency || currency,
  requestedRefundAmount: existingRefund?.requestedRefundAmount || decimalOrNull(amount),
  requestedRefundCurrency: existingRefund?.requestedRefundCurrency || currency,
  originalChargedCurrency: existingRefund?.originalChargedCurrency || payment?.chargedCurrency || payment?.currency || currency,
  providerRefundRequestReference: existingRefund?.providerRefundRequestReference || providerRefundRequestReference,
  providerRefundReference: existingRefund?.providerRefundReference || providerRefundReference,
  originalProviderTransactionId: existingRefund?.originalProviderTransactionId || payment?.orderTrackingId || payment?.providerTransactionId || booking?.paymentTransactionId || ""
});

const summarize = ({ booking, invoice, payments, refunds, requests, audit }) => ({
  booking: booking
    ? {
      id: asId(booking._id),
      bookingReference: booking.bookingReference,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      refundStatus: booking.refundStatus || "not_requested",
      amount: booking.amount,
      amountRefunded: booking.amountRefunded || booking.invoiceSnapshot?.amountRefunded || 0,
      currency: booking.currency,
    paymentMethod: booking.paymentMethod,
    paymentTransactionId: maskReference(booking.paymentTransactionId)
    }
    : null,
  invoice: invoice
    ? {
      id: asId(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      paymentStatus: invoice.paymentStatus,
      bookingStatus: invoice.bookingStatus,
      amountPaid: invoice.amountPaid,
      amountRefunded: invoice.amountRefunded,
      netAmountPaid: invoice.netAmountPaid,
      balanceDue: invoice.balanceDue
    }
    : null,
  payments: payments.map((payment) => ({
    id: asId(payment._id),
    provider: payment.provider,
    status: payment.status,
    paymentStatus: payment.paymentStatus,
    verificationStatus: payment.verificationStatus,
    accountingAllocationStatus: payment.accountingAllocationStatus,
    amountPaid: payment.amountPaid || payment.paidAmount || payment.amount || 0,
    refundedAmount: payment.refundedAmount || 0,
    refundStatus: payment.refundStatus || "not_required",
    refundedAt: payment.refundedAt || null,
    orderTrackingId: maskReference(payment.orderTrackingId || payment.providerTransactionId || ""),
    confirmationCode: maskReference(payment.confirmationCode || ""),
    merchantReference: payment.merchantReference || "",
    providerTransactionId: maskReference(payment.providerTransactionId || payment.orderTrackingId || payment.confirmationCode || "")
  })),
  refunds: refunds.map((refund) => ({
    id: asId(refund._id),
    refundReference: refund.refundReference,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    confirmedRefundedAmount: refund.confirmedRefundedAmount || 0,
    provider: refund.provider,
    providerRefundRequestReference: maskReference(refund.providerRefundRequestReference),
    providerRefundReference: maskReference(refund.providerRefundReference),
    completedAt: refund.completedAt || null,
    lastRefundSyncAt: refund.lastRefundSyncAt || null
  })),
  bookingRequests: requests.map((request) => ({
    id: asId(request._id),
    requestReference: request.requestReference,
    type: request.type,
    status: request.status,
    refundStatus: request.refund?.status || "not_required",
    refundId: asId(request.refund?.refundId),
    bokunStatus: request.bokunSync?.status || "not_required"
  })),
  auditEvents: audit.map((event) => ({
    action: event.action,
    actorRole: event.actorRole,
    createdAt: event.createdAt
  }))
});

const loadRecords = async () => {
  const booking = await Booking.findOne({ bookingReference });
  if (!booking) throw new Error(`Booking ${bookingReference} was not found.`);
  const [invoice, payments, refunds, requests, audit] = await Promise.all([
    Invoice.findOne({ bookingReference }).lean(),
    Payment.find({ bookingReference }).sort({ createdAt: -1 }),
    Refund.find({ bookingId: booking._id }).sort({ createdAt: -1 }),
    BookingRequest.find({ booking: booking._id }).sort({ createdAt: -1 }),
    AuditLog.find({
      $or: [
        { "metadata.bookingReference": bookingReference },
        { entityId: String(booking._id) }
      ]
    }).sort({ createdAt: 1 }).limit(25).lean()
  ]);
  return { booking, invoice, payments, refunds, requests, audit };
};

const ensureRecoveryRequest = async ({ booking, payment, existingRequest, amount, currency, provider }) => {
  if (existingRequest) return existingRequest;
  const payload = {
    requestReference: requestReference(),
    booking: booking._id,
    customer: booking.customer?.customerId || null,
    type: "cancel_booking",
    status: "completed",
    originalSnapshot: {
      date: booking.travelDate,
      startTime: booking.startTime || "",
      travelers: booking.paxSummary || {},
      optionId: booking.bokunOptionId,
      optionTitle: booking.optionTitle,
      pickup: booking.customer || {},
      totalAmount: booking.amount || payment?.amountPaid || payment?.paidAmount || amount || 0,
      amountPaid: payment?.amountPaid || payment?.paidAmount || booking.invoiceSnapshot?.amountPaid || amount || 0,
      currency: currency || booking.currency || payment?.currency || "USD"
    },
    customerReason: "Provider-confirmed refund reconciliation",
    adminDecision: {
      decision: "approved",
      customerFacingReason: "Cancellation and refund reconciled from provider evidence.",
      internalNote: "Created by reconcileRefund recovery script.",
      decidedAt: new Date()
    },
    refund: {
      required: true,
      estimatedAmount: amount,
      eligibleAmount: amount,
      approvedAmount: amount,
      requestedAmount: 0,
      confirmedRefundedAmount: 0,
      provider,
      providerLabel: refundsService.providerLabel(provider),
      status: "approved"
    },
    bokunSync: {
      status: "synced",
      syncedAt: new Date(),
      lastError: "",
      idempotencyKey: crypto.randomUUID(),
      bokunBookingId: booking.bokunBookingId || "",
      bokunConfirmationCode: booking.bokunConfirmationCode || "",
      responseSnapshot: { recoveredFromProviderRefundEvidence: true }
    },
    completedAt: new Date()
  };
  return BookingRequest.create(payload);
};

const createRecoveryRefund = async ({ booking, payment, request, existingRefund, amount, currency, provider, providerRefundRequestReference = "", finalProviderRefundReference = "" }) => {
  const duplicate = finalProviderRefundReference
    ? await Refund.findOne({ provider, providerRefundReference: finalProviderRefundReference })
    : null;
  if (duplicate) return duplicate;
  if (existingRefund) return existingRefund;
  const refund = await Refund.create({
    refundReference: refundReference(),
    bookingId: booking._id,
    bookingRequestId: request._id,
    customerId: booking.customer?.customerId || null,
    paymentId: payment?._id || null,
    provider,
    originalTransactionReference: refundsService.extractOriginalTransactionReference(payment || {}),
    originalProviderTransactionId: String(payment?.providerTransactionId || payment?.orderTrackingId || ""),
    amount,
    requestedAmount: amount,
    confirmedRefundedAmount: 0,
    eligibleRefundAmount: amount,
    currency,
    requestedRefundAmount: decimalOrNull(amount),
    requestedRefundCurrency: currency,
    accountingRefundAmount: decimalOrNull(amount),
    accountingRefundCurrency: currency,
    providerRefundRequestReference,
    providerRefundReference: finalProviderRefundReference,
    providerRefundStatus: manualProviderConfirmed ? "MANUAL_PROVIDER_CONFIRMED" : "PROVIDER_VERIFIED",
    reason: "Provider-confirmed refund reconciliation",
    status: "approved",
    approvedAt: new Date(),
    idempotencyKey: `${provider}-${finalProviderRefundReference || providerRefundRequestReference || request.requestReference}`,
    metadata: {
      source: "reconcileRefund",
      manualProviderConfirmed,
      recoveryScript: true,
      evidenceNote,
      adminActor
    }
  });
  request.refund = {
    ...(request.refund || {}),
    required: true,
    refundId: refund._id,
    status: "approved",
    approvedAmount: amount,
    requestedAmount: amount,
    confirmedRefundedAmount: 0,
    provider,
    providerLabel: refundsService.providerLabel(provider)
  };
  await request.save();
  return refund;
};

const assertApplyEvidence = ({ provider, existingRefund, plannedAmount, plannedCurrency, providerDecision }) => {
  const errors = [];
  if (!Number.isFinite(number(plannedAmount)) || number(plannedAmount) <= 0) errors.push("--amount must be the provider-confirmed refund amount unless an existing refund has an amount.");
  if (!plannedCurrency) errors.push("--currency must match the provider-confirmed refund currency unless an existing refund has a currency.");
  if (provider === "pesapal") {
    if (!providerDecision?.finalizable && !manualProviderConfirmed) {
      const verificationReason = providerDecision?.error?.message || providerDecision?.providerMessage || "Pesapal returned ambiguous refund evidence.";
      errors.push(`Pesapal final refund completion was not proven by GetTransactionStatus. Last verification: ${verificationReason} Use --manual-provider-confirmed with an evidence note only after merchant/email/support confirmation.`);
    }
    if (manualProviderConfirmed && !evidenceNote) errors.push("--evidence-note is required with --manual-provider-confirmed.");
    if (manualProviderConfirmed && !adminActor) errors.push("--admin-actor is required with --manual-provider-confirmed.");
  } else {
    if (!providerRefundReference && !existingRefund?.providerRefundReference) errors.push("--provider-refund-reference is required unless an existing refund already has one.");
    if (provider !== "paypal" && !manualProviderConfirmed) {
      errors.push("--manual-provider-confirmed is required for providers without automatic refund lookup.");
    }
  }
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.code = "REFUND_RECOVERY_EVIDENCE_REQUIRED";
    throw error;
  }
};

const run = async () => {
  if (!bookingReference) throw new Error("--booking-reference is required.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  if (apply && dryRun) throw new Error("Use either --dry-run or --apply, not both.");
  await mongoose.connect(process.env.MONGO_URI);

  const records = await loadRecords();
  const payment = pickPayment(records.payments);
  const existingRefund =
    (providerRefundReference
      ? records.refunds.find((refund) => String(refund.providerRefundReference || "") === providerRefundReference)
      : null) ||
    records.refunds[0] ||
    null;
  const provider = evidenceProvider || refundsService.normalizeProvider(existingRefund?.provider || payment?.provider || records.booking.paymentMethod || "");
  const plannedAmount = resolveLocalRefundAmount({ existingRefund, invoice: records.invoice, payment, booking: records.booking });
  const plannedCurrency = resolveLocalRefundCurrency({ existingRefund, invoice: records.invoice, payment, booking: records.booking });
  const existingProviderReference = String(existingRefund?.providerRefundReference || "").trim();
  const existingProviderRequestReference = String(existingRefund?.providerRefundRequestReference || "").trim();
  const legacyPesapalRequestReference =
    provider === "pesapal" &&
    existingProviderReference &&
    !existingProviderRequestReference &&
    !providerRefundReference &&
    (
      !FINAL_REFUND_STATUSES.has(String(existingRefund?.status || "").toLowerCase()) ||
      existingProviderReference === String(payment?.confirmationCode || "").trim() ||
      existingProviderReference === String(existingRefund?.originalTransactionReference || "").trim()
    );
  const plannedProviderReference = providerRefundReference || (legacyPesapalRequestReference ? "" : existingProviderReference);
  const plannedProviderRequestReference =
    existingProviderRequestReference ||
    (legacyPesapalRequestReference ? existingProviderReference : "") ||
    payment?.confirmationCode ||
    "";
  const providerEvidence = provider === "pesapal"
    ? await getPesapalEvidence({
      booking: records.booking,
      payment,
      refund: buildVirtualRefund({
        booking: records.booking,
        payment,
        existingRefund,
        amount: plannedAmount,
        currency: plannedCurrency,
        providerRefundRequestReference: plannedProviderRequestReference
      })
    })
    : null;
  let providerDecision = null;
  if (provider === "pesapal" && providerEvidence?.available) {
    try {
      providerDecision = refundsService.__testables.determinePesapalRefundVerification({
        booking: records.booking,
        payment,
        refund: buildVirtualRefund({
          booking: records.booking,
          payment,
          existingRefund,
          amount: plannedAmount,
          currency: plannedCurrency,
          providerRefundRequestReference: plannedProviderRequestReference
        }),
        verification: providerEvidence.verification
      });
    } catch (error) {
      providerDecision = {
        finalizable: false,
        status: "verification_required",
        providerMessage: error.message,
        error: { code: error.code || "PESAPAL_REFUND_EVIDENCE_INVALID", message: error.message }
      };
    }
  }
  const summary = summarize(records);
  const displayProviderRequestReference =
    existingRefund?.providerRefundRequestReference ||
    payment?.confirmationCode ||
    providerDecision?.providerRefundRequestReference ||
    providerEvidence?.verification?.confirmationCode ||
    "";
  const evidenceSufficient =
    provider === "pesapal"
      ? Boolean(providerDecision?.finalizable || (manualProviderConfirmed && evidenceNote && adminActor))
      : true;
  const plan = {
    mode: dryRun ? "dry-run" : "apply",
    bookingReference,
    sourceOfTruth: provider === "paypal" && plannedProviderReference && !manualProviderConfirmed
      ? "PayPal refund status API"
      : provider === "pesapal"
        ? "Pesapal GetTransactionStatus plus local accounting evidence"
        : "provider dashboard evidence supplied to this script",
    planned: {
      createBookingRequest: evidenceSufficient && !records.requests.length,
      createRefund: evidenceSufficient && !existingRefund,
      finalizeRefund: evidenceSufficient,
      markBookingCancelled: evidenceSufficient && markCancelled,
      provider,
      providerRefundRequestReference: maskReference(displayProviderRequestReference),
      providerRefundReference: maskReference(plannedProviderReference),
      refundAmount: plannedAmount,
      refundCurrency: plannedCurrency,
      refundedAt,
      manualProviderConfirmed,
      evidenceSufficient,
      writesBlockedByEvidence: !evidenceSufficient
    },
    providerEvidence: provider === "pesapal"
      ? {
        available: Boolean(providerEvidence?.available),
        orderTrackingId: maskReference(providerEvidence?.orderTrackingId || ""),
        status: providerEvidence?.verification?.status || "",
        statusCode: providerEvidence?.verification?.statusCode ?? null,
        amount: providerEvidence?.verification?.amount ?? null,
        currency: providerEvidence?.verification?.currency || "",
        confirmationCode: maskReference(providerEvidence?.verification?.confirmationCode || ""),
        merchantReference: providerEvidence?.verification?.merchantReference || "",
        decision: providerDecision
          ? {
            finalizable: Boolean(providerDecision.finalizable),
            status: providerDecision.status,
            providerMessage: providerDecision.providerMessage
          }
          : null,
        error: providerEvidence?.error || providerDecision?.error || null
      }
      : null,
    currentState: summary,
    rollback: "Take a MongoDB backup before --apply. Rollback is to restore Booking, Invoice, Payment, Refund, BookingRequest, and AuditLog documents for this booking from that backup."
  };

  if (dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  assertApplyEvidence({ provider, existingRefund, plannedAmount, plannedCurrency, providerDecision });

  const request = await ensureRecoveryRequest({
    booking: records.booking,
    payment,
    existingRequest: records.requests.find((row) => row.type === "cancel_booking") || null,
    amount: plannedAmount,
    currency: plannedCurrency,
    provider
  });
  const refund = await createRecoveryRefund({
    booking: records.booking,
    payment,
    request,
    existingRefund,
    amount: plannedAmount,
    currency: plannedCurrency,
    provider,
    providerRefundRequestReference: plannedProviderRequestReference || providerDecision?.providerRefundRequestReference || providerEvidence?.verification?.confirmationCode || "",
    finalProviderRefundReference: plannedProviderReference
  });

  let result;
  if (provider === "paypal" && !manualProviderConfirmed) {
    result = await refundsService.verifyRefundStatus({
      refundId: refund._id,
      auth: { role: "system" },
      traceId: `reconcile-refund-${Date.now()}`
    });
  } else {
    result = await refundsService.finalizeSuccessfulRefund({
      bookingId: records.booking._id,
      paymentId: payment?._id || refund.paymentId || null,
      refundId: refund._id,
      refundAmount: plannedAmount || refund.amount,
      refundCurrency: plannedCurrency || refund.accountingRefundCurrency || refund.currency,
      provider,
      providerRefundRequestReference: refund.providerRefundRequestReference || providerDecision?.providerRefundRequestReference || "",
      providerRefundReference: providerRefundReference || refund.providerRefundReference,
      providerTransactionId: String(payment?.providerTransactionId || payment?.orderTrackingId || ""),
      refundedAt,
      rawProviderResponse: {
        source: provider === "pesapal" && providerDecision?.finalizable
          ? "pesapal_get_transaction_status"
          : "provider_dashboard_reconciliation",
        manualProviderConfirmed,
        providerRefundReference: providerRefundReference || refund.providerRefundReference,
        providerRefundRequestReference: refund.providerRefundRequestReference || providerDecision?.providerRefundRequestReference || "",
        amount: plannedAmount || refund.amount,
        currency: plannedCurrency || refund.accountingRefundCurrency || refund.currency,
        evidenceNote,
        adminActor,
        providerEvidence
      },
      auth: { role: "system", id: adminActor || null },
      requestId: `reconcile-refund-${Date.now()}`,
      source: "reconcile_refund_script",
      reason: evidenceNote || "Provider-confirmed refund reconciled by recovery script",
      markBookingCancelled: markCancelled
    });
  }

  const after = await loadRecords();
  console.log(JSON.stringify({
    mode: "apply",
    bookingReference,
    result,
    before: summary,
    after: summarize(after)
  }, null, 2));
};

run()
  .catch((error) => {
    console.error(JSON.stringify({
      error: {
        code: error.code || "REFUND_RECOVERY_FAILED",
        message: error.message
      }
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => null);
  });

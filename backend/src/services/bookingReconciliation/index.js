const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const AccountingPosting = require("../../models/AccountingPosting");
const JournalEntry = require("../../models/JournalEntry");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const { loadSettlementViews } = require("../bookingPayment/settlementView");
const { resolveGuestPaymentPolicy } = require("../bookingPayment/policy");

const n = (value) => Number(value?.toString?.() ?? value ?? 0) || 0;
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const lower = (value) => token(value).toLowerCase();
const money = (value) => Number(n(value).toFixed(2));
const OTA = new Set(["VIATOR", "GETYOURGUIDE", "BOKUN_MARKETPLACE", "TOURHQ", "AIRBNB"]);
const COMPLETED_REFUNDS = new Set(["refunded", "partially_refunded"]);
const PAID_PAYMENTS = new Set(["paid", "completed", "success", "verified"]);
const DIRECT = new Set(["DIRECT_WEBSITE"]);
const PROVIDER_LABELS = { GETYOURGUIDE: "GetYourGuide", VIATOR: "Viator", BOKUN_MARKETPLACE: "Bokun Marketplace", PESAPAL: "Pesapal", DPO: "DPO", PAYPAL: "PayPal", CASH_ON_ARRIVAL: "Cash", MANUAL_BANK: "Bank Transfer" };
const CHANNEL_LABELS = {
  DIRECT_WEBSITE: "Riser Direct", GETYOURGUIDE: "GetYourGuide", VIATOR: "Viator",
  BOKUN_MARKETPLACE: "Bokun Marketplace", OTHER: "Other", UNKNOWN: "Unknown"
};

const bookingAmount = (b) => money(b.pricingSnapshot?.finalPayable ?? b.pricingSnapshot?.grossAmount ?? b.amount);
const bookingCurrency = (b) => upper(b.transactionCurrency || b.bookingPaymentCurrency || b.currency || b.pricingSnapshot?.currency);
const customerName = (b) => token(`${b.customer?.firstName || ""} ${b.customer?.lastName || ""}`) || "Guest";
const channel = (b) => upper(b.salesChannel || "UNKNOWN") || "UNKNOWN";
const channelView = (booking) => {
  const code = channel(booking);
  return { code, label: CHANNEL_LABELS[code] || CHANNEL_LABELS.OTHER, confidence: code === "UNKNOWN" ? "UNKNOWN" : "RECORDED" };
};
const providerCode = (payment) => upper(payment?.provider);
const isPaidPayment = (p) => PAID_PAYMENTS.has(lower(p.status)) && lower(p.verificationStatus) === "verified";
const paymentAmount = (payment) => n(payment.accountingAmount ?? payment.chargedAmount ?? payment.amountPaid ?? payment.paidAmount ?? payment.amount);
const uniqueVerifiedPayments = (payments, currency) => {
  const byIntent = new Map();
  payments.filter((payment) => isPaidPayment(payment)).forEach((payment) => {
    const paymentCurrency = upper(payment.accountingCurrency || payment.chargedCurrency || payment.orderCurrency || payment.currency);
    const key = token(payment.intentId || payment.providerTransactionId || payment.orderTrackingId || payment._id);
    if (!key || (currency && paymentCurrency && paymentCurrency !== currency)) return;
    const existing = byIntent.get(key);
    if (!existing || paymentAmount(payment) > paymentAmount(existing)) byIntent.set(key, payment);
  });
  return [...byIntent.values()];
};

const customerPayment = (booking, payments, invoice) => {
  const currency = upper(booking.bookingPaymentCurrency) || bookingCurrency(booking);
  const verified = uniqueVerifiedPayments(payments, currency);
  const paid = verified.reduce((sum, payment) => sum + paymentAmount(payment), 0);
  const total = bookingAmount(booking);
  const policy = resolveGuestPaymentPolicy({ booking, total, verifiedPaidAmount: paid });
  const amount = money(policy.amountPaid);
  const refunded = money(invoice?.amountRefunded ?? 0);
  const netAmount = money(Math.max(0, amount - refunded));
  const status = refunded > 0
    ? refunded + .009 >= amount ? "REFUNDED" : "PARTIALLY_REFUNDED"
    : amount <= 0 ? "UNPAID" : amount + .009 >= total ? "PAID" : "PARTIALLY_PAID";
  return { status, amount, netAmount, currency, source: policy.source, collector: policy.collector, reportedStatus: upper(booking.bookingPaymentStatus) || "UNKNOWN", verifiedPaymentCount: verified.length };
};

const payout = ({ isOta, settlement, currency }) => {
  if (!isOta) return { applicable: false, status: "NOT_APPLICABLE", expectedAmount: null, receivedAmount: null, currency, evidenceCount: 0, source: "NOT_APPLICABLE" };
  if (!settlement || settlement.source !== "SETTLEMENT_DOMAIN") return { applicable: true, status: "AWAITING_SETTLEMENT_DATA", expectedAmount: null, receivedAmount: null, currency, evidenceCount: 0, source: "AWAITING_EVIDENCE" };
  return { applicable: true, status: upper(settlement.status || "UNKNOWN"), expectedAmount: settlement.expectedAmount ?? null, receivedAmount: settlement.receivedAmount ?? null, currency: settlement.currency || currency, evidenceCount: settlement.evidenceCount || 0, source: settlement.evidenceSource || "SETTLEMENT_DOMAIN", references: settlement.settlementReferences || [] };
};

const buildRow = ({ booking, invoice, payments = [], refunds = [], postings = [], journals = [], settlement }) => {
  const amount = bookingAmount(booking); const currency = bookingCurrency(booking);
  const payment = customerPayment(booking, payments, invoice);
  const refundAmount = money(refunds.filter(r => COMPLETED_REFUNDS.has(lower(r.status))).reduce((s,r)=>s+n(r.confirmedAccountingRefundedAmount ?? r.confirmedRefundedAmount ?? r.amount),0));
  if (refundAmount > 0 && ["PAID", "PARTIALLY_PAID"].includes(payment.status)) payment.status = refundAmount + .009 >= n(payment.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const channelInfo = channelView(booking);
  const verifiedPayments = uniqueVerifiedPayments(payments, currency);
  const providers = [...new Set(verifiedPayments.map(providerCode).filter(Boolean))];
  const isOta = OTA.has(channelInfo.code);
  const collectorCode = payment.collector ? upper(payment.collector).replace(/\s+/g, "_")
    : DIRECT.has(channelInfo.code) && providers.length === 1 ? providers[0] : "UNKNOWN";
  const evidenceSource = payment.source === "OTA_CHANNEL"
    ? "CHANNEL_POLICY"
    : providers.length === 1 ? `${providers[0]}_VERIFIED` : payment.source || "UNKNOWN";
  const providerVerification = isOta
    ? "NOT_APPLICABLE"
    : verifiedPayments.length ? "VERIFIED" : payments.some(p => lower(p.verificationStatus) === "pending") ? "PENDING" : "UNKNOWN";
  const paymentProviders = [...new Set(payments.map((payment) => providerCode(payment)).filter(Boolean))];
  const latestVerifiedAt = verifiedPayments.map((payment) => payment.lastVerifiedAt || payment.paidAt || payment.updatedAt).filter(Boolean).sort().at(-1) || null;
  const invoiceCurrency = upper(invoice?.transactionCurrency || invoice?.accountingCurrency);
  const paymentCurrencies = new Set(payments.map(p=>upper(p.accountingCurrency || p.currency || p.orderCurrency)).filter(Boolean));
  const reasons = [];
  if (!currency) reasons.push("MISSING_BOOKING_CURRENCY");
  if (!invoice) reasons.push("MISSING_INVOICE");
  if (invoiceCurrency && currency && invoiceCurrency !== currency) reasons.push("CURRENCY_MISMATCH");
  if ([...paymentCurrencies].some(c=>currency && c!==currency)) reasons.push("CURRENCY_MISMATCH");
  if (invoice && payment.status === "PAID" && upper(invoice.paymentStatus) !== "PAID") reasons.push("INVOICE_BALANCE_MISMATCH");
  if (payment.status === "PAID" && payment.amount != null && Math.abs(payment.amount - amount) > .01) reasons.push("PAYMENT_AMOUNT_MISMATCH");
  const postingKeys = new Set(); let duplicate = false;
  postings.forEach(p=>{const key=upper(p.postingType); if(postingKeys.has(key)) duplicate=true; postingKeys.add(key)});
  if (duplicate) reasons.push("DUPLICATE_POSTING");
  const postedJournal = journals.find(j=>upper(j.status)==="POSTED");
  if (channelInfo.code === "UNKNOWN" || channelInfo.code === "OTHER") reasons.push("SALES_CHANNEL_UNKNOWN");
  if (collectorCode === "UNKNOWN" && (DIRECT.has(channelInfo.code) || isOta)) reasons.push("COLLECTOR_UNKNOWN");
  const payoutView = payout({ isOta, settlement, currency });
  const mismatch = reasons.some(r=>["CURRENCY_MISMATCH","PAYMENT_AMOUNT_MISMATCH","INVOICE_BALANCE_MISMATCH","REFUND_MISMATCH","DUPLICATE_POSTING","UNEXPECTED_BALANCE"].includes(r));
  const needsReview = reasons.some(r=>["MISSING_INVOICE","MISSING_BOOKING_CURRENCY","SALES_CHANNEL_UNKNOWN","COLLECTOR_UNKNOWN"].includes(r));
  const reconciliationStatus = mismatch ? "MISMATCH" : needsReview ? "NEEDS_REVIEW" : reasons.length ? "PARTIAL" : "MATCHED";
  return {
    id:String(booking._id), bookingReference:booking.bookingReference, bokunReference:booking.bokunExternalBookingReference||booking.bokunConfirmationCode||booking.bokunBookingId||"",
    customer:{name:customerName(booking),email:booking.customer?.email||""}, product:booking.productTitle||"", option:booking.optionTitle||"",
    bookingDate:booking.createdAt, travelDate:booking.travelDate, bookingStatus:upper(booking.bookingStatus), amount, currency,
    channel:channelInfo,
    customerPayment:{...payment, paidAmount:payment.amount, refundedAmount:refundAmount, remainingAmount:Math.max(0, money(amount - n(payment.netAmount))), paymentCount:payments.length, paymentIds:verifiedPayments.map(payment => String(payment._id)).filter(Boolean), providers:paymentProviders, latestVerifiedAt, evidenceSource, evidenceTimestamp:booking.bookingPaymentStatusSyncedAt || null},
    collector:{code:collectorCode, label:PROVIDER_LABELS[collectorCode] || CHANNEL_LABELS[collectorCode] || "Unknown", evidenceSource},
    provider:{code:isOta ? "NOT_APPLICABLE" : providers.length === 1 ? providers[0] : "UNKNOWN", verificationStatus:providerVerification, transactionReference:verifiedPayments[0]?.providerTransactionId || verifiedPayments[0]?.orderTrackingId || ""},
    settlement:payoutView,
    invoice:invoice?{id:String(invoice._id),reference:invoice.invoiceNumber,paymentStatus:upper(invoice.paymentStatus),total:money(invoice.totalAmount??invoice.total),paidAmount:money(invoice.amountPaid??invoice.paidAmount),balance:money(invoice.balanceDueAmount??invoice.balanceDue),currency:invoiceCurrency}:null,
    bokun:{applicable:Boolean(booking.bokunBookingId||booking.operationalSource === "BOKUN"),bookingId:booking.bokunBookingId||"",confirmationCode:booking.bokunConfirmationCode||booking.bokunExternalBookingReference||"",bookingStatus:upper(booking.bokunStatus?.normalized||"UNKNOWN"),fulfillmentEvidence:booking.bokunStatus?.normalized||"UNKNOWN"},
    refund:{status:refunds.length?upper(refunds[0].status):"NOT_REQUESTED",amount:refundAmount,count:refunds.length},
    accounting:{postingCount:postings.length,journalReference:postedJournal?.entryNumber||"",status:postings.length||postedJournal?"POSTED":"MISSING"},
    reconciliation:{status:reconciliationStatus,result:reconciliationStatus,severity:mismatch ? "ERROR" : needsReview ? "WARNING" : reasons.length ? "INFO" : "NONE",dimensions:{bookingIdentity:"MATCHED",customerPayment:payment.status === "UNKNOWN" ? "UNKNOWN" : payment.status,providerVerification,invoiceBalance:invoice ? "AVAILABLE" : "UNAVAILABLE",bokunConfirmation:booking.bokunBookingId ? "MATCHED" : "UNAVAILABLE",settlement:payoutView.status},difference:payment.amount==null?null:money(amount-payment.amount-refundAmount),reasonCodes:reasons,reasons,lastCheckedAt:new Date().toISOString()},
    needsAttention: reconciliationStatus === "MISMATCH" || reconciliationStatus === "NEEDS_REVIEW"
  };
};

const baseQuery = (f={}) => { const q={}; if(f.fromDate||f.toDate)q.createdAt={...(f.fromDate?{$gte:new Date(f.fromDate)}:{}),...(f.toDate?{$lte:new Date(`${f.toDate}T23:59:59.999Z`)}:{})}; if(f.channel)q.salesChannel=upper(f.channel); if(f.bookingStatus)q.bookingStatus=lower(f.bookingStatus); if(f.currency)q.$or=[{transactionCurrency:upper(f.currency)},{currency:upper(f.currency)},{bookingPaymentCurrency:upper(f.currency)}]; if(f.search){const x=new RegExp(token(f.search).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i");q.$and=[{$or:[{bookingReference:x},{bokunExternalBookingReference:x},{bokunConfirmationCode:x},{productTitle:x},{"customer.firstName":x},{"customer.lastName":x},{"customer.email":x}]}]}; return q; };

const loadRows = async (bookings) => {
  const refs=bookings.map(b=>b.bookingReference); const ids=bookings.map(b=>b._id);
  const [invoices,payments,refunds,postings,journals,settlements]=await Promise.all([
    Invoice.find({bookingReference:{$in:refs}}).lean(), Payment.find({bookingReference:{$in:refs}}).lean(), Refund.find({bookingId:{$in:ids}}).lean(),
    AccountingPosting.find({bookingReference:{$in:refs}}).lean(), JournalEntry.find({$or:[{"source.sourceReference":{$in:refs}},{"sourceSnapshot.booking.bookingReference":{$in:refs}},{"sourceSnapshot.invoice.bookingReference":{$in:refs}}]}).lean(),
    loadSettlementViews(refs,new Map(bookings.map(b=>[b.bookingReference,{expectedAmount:null,currency:bookingCurrency(b)}])))
  ]);
  const group=(rows,key)=>rows.reduce((m,r)=>{const k=token(key(r));if(k){if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m},new Map());
  const inv=group(invoices,r=>r.bookingReference), pay=group(payments,r=>r.bookingReference), ref=group(refunds,r=>String(r.bookingId)), post=group(postings,r=>r.bookingReference);
  return bookings.map(b=>buildRow({booking:b,invoice:(inv.get(b.bookingReference)||[])[0],payments:pay.get(b.bookingReference)||[],refunds:ref.get(String(b._id))||[],postings:post.get(b.bookingReference)||[],journals:journals.filter(j=>JSON.stringify(j.sourceSnapshot||{}).includes(b.bookingReference)||refs.includes(j.source?.sourceReference)&&j.source?.sourceReference===b.bookingReference),settlement:settlements.get(b.bookingReference)}));
};

const matches = (row,f={}) => {const view=upper(f.status);const viewMatch=!view||(view==="PAYMENTS"?row.customerPayment.status!=="UNPAID":view==="SETTLEMENTS"?row.settlement.status!=="NOT_APPLICABLE":view==="REFUNDS"?row.refund.count>0:row.reconciliation.status===view);return (!f.paymentStatus||row.customerPayment.status===upper(f.paymentStatus))&&(!f.settlementStatus||row.settlement.status===upper(f.settlementStatus))&&(!f.reconciliationStatus||row.reconciliation.status===upper(f.reconciliationStatus))&&viewMatch;};
const summarize = rows => {
  const currencies = [...new Set(rows.map(row => row.currency).filter(Boolean))];
  const safe = currencies.length === 1;
  const sum = fn => safe ? money(rows.reduce((total, row) => total + n(fn(row)), 0)) : null;
  const count = status => rows.filter(row => row.reconciliation.status === status).length;
  const reconciledCount = count("MATCHED");
  const byCurrency = currencies.map(currency => {
    const scoped = rows.filter(row => row.currency === currency);
    const total = fn => money(scoped.reduce((value, row) => value + n(fn(row)), 0));
    const otaRows = scoped.filter(row => row.settlement.applicable);
    const expectedRows = otaRows.filter(row => row.settlement.expectedAmount != null);
    const receivedRows = otaRows.filter(row => row.settlement.receivedAmount != null);
    return {
      currency,
      bookingTotal: total(row => row.amount),
      guestPaid: total(row => row.customerPayment.amount),
      guestBalance: total(row => row.customerPayment.remainingAmount),
      otaPayoutExpected: expectedRows.length ? money(expectedRows.reduce((value, row) => value + n(row.settlement.expectedAmount), 0)) : null,
      otaPayoutReceived: receivedRows.length ? money(receivedRows.reduce((value, row) => value + n(row.settlement.receivedAmount), 0)) : null,
      otaPayoutPending: expectedRows.length ? money(expectedRows.reduce((value, row) => value + Math.max(0, n(row.settlement.expectedAmount) - n(row.settlement.receivedAmount)), 0)) : null
    };
  });
  return { total: rows.length, currency: safe ? currencies[0] : "", currencies, mixedCurrencies: !safe && currencies.length > 1, totalBookingValue: sum(row => row.amount), customerPaidAmount: sum(row => row.customerPayment.amount), outstandingCustomerAmount: sum(row => row.customerPayment.remainingAmount), settlementPendingAmount: null, settledAmount: sum(row => row.settlement.receivedAmount), byCurrency, reconciledCount, needsReviewCount: count("NEEDS_REVIEW"), mismatchCount: count("MISMATCH"), unreconciledCount: count("UNRECONCILED"), healthPercent: rows.length ? Number((reconciledCount / rows.length * 100).toFixed(1)) : null };
};

const createSummaryAccumulator = () => ({ total: 0, currencies: new Map(), reconciledCount: 0, needsReviewCount: 0, mismatchCount: 0, unreconciledCount: 0 });
const addToSummary = (summary, row) => {
  summary.total += 1;
  const currency = row.currency || "";
  if (!summary.currencies.has(currency)) summary.currencies.set(currency, { bookingTotal: 0, guestPaid: 0, guestBalance: 0, otaPayoutExpected: 0, otaPayoutReceived: 0, expectedCount: 0, receivedCount: 0 });
  const total = summary.currencies.get(currency);
  total.bookingTotal += n(row.amount); total.guestPaid += n(row.customerPayment.amount); total.guestBalance += n(row.customerPayment.remainingAmount);
  if (row.settlement.expectedAmount != null) { total.otaPayoutExpected += n(row.settlement.expectedAmount); total.expectedCount += 1; }
  if (row.settlement.receivedAmount != null) { total.otaPayoutReceived += n(row.settlement.receivedAmount); total.receivedCount += 1; }
  if (row.reconciliation.status === "MATCHED") summary.reconciledCount += 1;
  if (row.reconciliation.status === "NEEDS_REVIEW") summary.needsReviewCount += 1;
  if (row.reconciliation.status === "MISMATCH") summary.mismatchCount += 1;
  if (row.reconciliation.status === "UNRECONCILED") summary.unreconciledCount += 1;
};
const finalizeSummary = summary => {
  const currencies = [...summary.currencies.keys()].filter(Boolean); const safe = currencies.length === 1;
  const byCurrency = currencies.map(currency => { const total = summary.currencies.get(currency); return { currency, bookingTotal: money(total.bookingTotal), guestPaid: money(total.guestPaid), guestBalance: money(total.guestBalance), otaPayoutExpected: total.expectedCount ? money(total.otaPayoutExpected) : null, otaPayoutReceived: total.receivedCount ? money(total.otaPayoutReceived) : null, otaPayoutPending: total.expectedCount ? money(total.otaPayoutExpected - total.otaPayoutReceived) : null }; });
  const only = safe ? byCurrency[0] : null;
  return { total: summary.total, currency: safe ? currencies[0] : "", currencies, mixedCurrencies: !safe && currencies.length > 1, totalBookingValue: only?.bookingTotal ?? null, customerPaidAmount: only?.guestPaid ?? null, outstandingCustomerAmount: only?.guestBalance ?? null, settlementPendingAmount: null, settledAmount: only?.otaPayoutReceived ?? null, byCurrency, reconciledCount: summary.reconciledCount, needsReviewCount: summary.needsReviewCount, mismatchCount: summary.mismatchCount, unreconciledCount: summary.unreconciledCount, healthPercent: summary.total ? Number((summary.reconciledCount / summary.total * 100).toFixed(1)) : null };
};

const getReconciliation = async (f = {}) => {
  const requestedPage = Math.max(1, Number(f.page || 1)); const limit = Math.min(100, Math.max(1, Number(f.limit || 10))); const direction = f.order === "asc" ? 1 : -1;
  const sort = f.sort === "bookingReference" ? { bookingReference: direction, _id: direction } : { createdAt: direction, _id: direction };
  const cursor = Booking.find(baseQuery(f)).sort(sort).lean().cursor({ batchSize: 100 });
  const summary = createSummaryAccumulator(); const counts = { all: 0, payments: 0, settlements: 0, refunds: 0, reconciled: 0, needsReview: 0 }; const items = [];
  let matched = 0; let batch = [];
  const process = async () => {
    const rows = await loadRows(batch); batch = [];
    rows.forEach(row => {
      if (!matches(row, { ...f, status: "" })) return;
      counts.all += 1; if (row.customerPayment.status !== "UNPAID") counts.payments += 1; if (row.settlement.status !== "NOT_APPLICABLE") counts.settlements += 1; if (row.refund.count) counts.refunds += 1; if (row.reconciliation.status === "MATCHED") counts.reconciled += 1; else counts.needsReview += 1;
      if (!matches(row, f)) return;
      addToSummary(summary, row); matched += 1;
      if (matched > (requestedPage - 1) * limit && items.length < limit) items.push(row);
    });
  };
  for await (const booking of cursor) { batch.push(booking); if (batch.length === 100) await process(); }
  if (batch.length) await process();
  const totalPages = Math.max(1, Math.ceil(matched / limit)); const page = Math.min(requestedPage, totalPages);
  return { generatedAt: new Date().toISOString(), items: page === requestedPage ? items : [], summary: finalizeSummary(summary), counts, page, pageSize: limit, total: matched, totalPages, pagination: { page, limit, totalRecords: matched, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 } };
};
const getDetail=async id=>{const booking=await Booking.findById(id).lean();if(!booking)throw new AppError("Booking not found",404,"BOOKING_NOT_FOUND");const [row,audit]=await Promise.all([loadRows([booking]).then(x=>x[0]),AuditLog.find({entityType:"Booking",entityId:String(id)}).sort({createdAt:-1}).limit(20).lean()]);return{...row,auditTrail:audit};};
const run=async({id,auth={},requestId=""})=>{const before=await getDetail(id);await AuditLog.create({actorId:auth.id||null,actorRole:auth.role||"system",action:"booking_accounting_reconciliation_run",entityType:"Booking",entityId:id,reference:before.bookingReference,requestId,reason:"Read-only reconciliation run",after:{status:before.reconciliation.status,reasons:before.reconciliation.reasons}});return getDetail(id);};
module.exports={getReconciliation,getDetail,run,__testables:{buildRow,summarize,customerPayment}};

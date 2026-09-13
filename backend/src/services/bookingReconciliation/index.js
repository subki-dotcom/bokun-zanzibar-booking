const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const AccountingPosting = require("../../models/AccountingPosting");
const JournalEntry = require("../../models/JournalEntry");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const { loadSettlementViews } = require("../bookingPayment/settlementView");

const n = (value) => Number(value?.toString?.() ?? value ?? 0) || 0;
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const lower = (value) => token(value).toLowerCase();
const money = (value) => Number(n(value).toFixed(2));
const OTA = new Set(["VIATOR", "GETYOURGUIDE", "BOKUN_MARKETPLACE", "TOURHQ", "AIRBNB"]);
const COMPLETED_REFUNDS = new Set(["refunded", "partially_refunded"]);
const PAID_PAYMENTS = new Set(["paid", "completed", "success", "verified"]);

const bookingAmount = (b) => money(b.pricingSnapshot?.finalPayable ?? b.pricingSnapshot?.grossAmount ?? b.amount);
const bookingCurrency = (b) => upper(b.transactionCurrency || b.bookingPaymentCurrency || b.currency || b.pricingSnapshot?.currency);
const customerName = (b) => token(`${b.customer?.firstName || ""} ${b.customer?.lastName || ""}`) || "Guest";
const channel = (b) => upper(b.salesChannel || b.sourceChannel || "OTHER");
const isPaidPayment = (p) => PAID_PAYMENTS.has(lower(p.status)) && ["verified", ""].includes(lower(p.verificationStatus));

const customerPayment = (booking, payments, invoice) => {
  const canonical = upper(booking.bookingPaymentStatus);
  const source = upper(booking.bookingPaymentStatusSource);
  const currency = upper(booking.bookingPaymentCurrency) || bookingCurrency(booking);
  if (source === "BOKUN" && ["PAID", "PARTIALLY_PAID", "UNPAID", "REFUNDED", "UNKNOWN"].includes(canonical)) {
    return { status: canonical, amount: booking.bookingPaymentReportedAmount == null ? null : money(booking.bookingPaymentReportedAmount), currency, source, reportedStatus: canonical };
  }
  const paid = payments.filter(isPaidPayment).reduce((sum, p) => sum + n(p.accountingAmount ?? p.amountPaid ?? p.paidAmount ?? p.amount), 0);
  const amount = money(paid || invoice?.paidAccountingAmount || invoice?.amountPaid || 0);
  const total = bookingAmount(booking);
  return { status: amount <= 0 ? "UNPAID" : amount + .009 >= total ? "PAID" : "PARTIALLY_PAID", amount, currency, source: source || "LOCAL", reportedStatus: canonical || "UNKNOWN" };
};

const buildRow = ({ booking, invoice, payments = [], refunds = [], postings = [], journals = [], settlement }) => {
  const amount = bookingAmount(booking); const currency = bookingCurrency(booking);
  const payment = customerPayment(booking, payments, invoice);
  const refundAmount = money(refunds.filter(r => COMPLETED_REFUNDS.has(lower(r.status))).reduce((s,r)=>s+n(r.confirmedAccountingRefundedAmount ?? r.confirmedRefundedAmount ?? r.amount),0));
  const invoiceCurrency = upper(invoice?.transactionCurrency || invoice?.accountingCurrency);
  const paymentCurrencies = new Set(payments.map(p=>upper(p.accountingCurrency || p.currency || p.orderCurrency)).filter(Boolean));
  const reasons = [];
  if (!currency) reasons.push("MISSING_BOOKING_CURRENCY");
  if (!invoice) reasons.push("MISSING_INVOICE");
  if (invoiceCurrency && currency && invoiceCurrency !== currency) reasons.push("CURRENCY_MISMATCH");
  if ([...paymentCurrencies].some(c=>currency && c!==currency)) reasons.push("CURRENCY_MISMATCH");
  if (payment.status === "PAID" && payment.amount != null && Math.abs(payment.amount - amount) > .01) reasons.push("PAYMENT_AMOUNT_MISMATCH");
  const postingKeys = new Set(); let duplicate = false;
  postings.forEach(p=>{const key=upper(p.postingType); if(postingKeys.has(key)) duplicate=true; postingKeys.add(key)});
  if (duplicate) reasons.push("DUPLICATE_POSTING");
  const postedJournal = journals.find(j=>upper(j.status)==="POSTED");
  if (!postings.length && !postedJournal) reasons.push("MISSING_GL_POSTING");
  const ota = OTA.has(channel(booking));
  let settlementStatus = ota ? upper(settlement?.status || "PENDING") : "NOT_APPLICABLE";
  if (ota && payment.status === "PAID" && ["PENDING", "UNAVAILABLE", ""].includes(settlementStatus)) reasons.push("SETTLEMENT_PENDING");
  const mismatch = reasons.some(r=>["CURRENCY_MISMATCH","PAYMENT_AMOUNT_MISMATCH","REFUND_MISMATCH","DUPLICATE_POSTING","UNEXPECTED_BALANCE"].includes(r));
  const needsReview = reasons.some(r=>["MISSING_INVOICE","MISSING_GL_POSTING","MISSING_BOOKING_CURRENCY"].includes(r));
  const reconciliationStatus = mismatch ? "MISMATCH" : needsReview ? "NEEDS_REVIEW" : reasons.length ? "UNRECONCILED" : "RECONCILED";
  return {
    id:String(booking._id), bookingReference:booking.bookingReference, bokunReference:booking.bokunExternalBookingReference||booking.bokunConfirmationCode||booking.bokunBookingId||"",
    customer:{name:customerName(booking),email:booking.customer?.email||""}, product:booking.productTitle||"", option:booking.optionTitle||"", channel:channel(booking),
    bookingDate:booking.createdAt, travelDate:booking.travelDate, bookingStatus:upper(booking.bookingStatus), amount, currency,
    customerPayment:payment,
    settlement:{status:settlementStatus,expectedAmount:settlement?.expectedAmount??null,receivedAmount:settlement?.receivedAmount??null,currency:settlement?.currency||currency,evidenceCount:settlement?.evidenceCount||0,reference:""},
    invoice:invoice?{id:String(invoice._id),reference:invoice.invoiceNumber,status:upper(invoice.paymentStatus),total:money(invoice.totalAmount??invoice.total),balance:money(invoice.balanceDueAmount??invoice.balanceDue),currency:invoiceCurrency}:null,
    refund:{status:refunds.length?upper(refunds[0].status):"NOT_REQUESTED",amount:refundAmount,count:refunds.length},
    accounting:{postingCount:postings.length,journalReference:postedJournal?.entryNumber||"",status:postings.length||postedJournal?"POSTED":"MISSING"},
    reconciliation:{status:reconciliationStatus,difference:payment.amount==null?null:money(amount-payment.amount-refundAmount),reasons,lastCheckedAt:new Date().toISOString()}
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
const summarize = rows => {const currencies=[...new Set(rows.map(r=>r.currency).filter(Boolean))];const safe=currencies.length===1;const sum=fn=>safe?money(rows.reduce((s,r)=>s+n(fn(r)),0)):null;const count=status=>rows.filter(r=>r.reconciliation.status===status).length;return{total:rows.length,currency:safe?currencies[0]:"",currencies,mixedCurrencies:!safe&&currencies.length>1,totalBookingValue:sum(r=>r.amount),customerPaidAmount:sum(r=>r.customerPayment.amount),outstandingCustomerAmount:sum(r=>Math.max(0,r.amount-n(r.customerPayment.amount)-r.refund.amount)),settlementPendingAmount:null,settledAmount:sum(r=>r.settlement.receivedAmount),reconciledCount:count("RECONCILED"),needsReviewCount:count("NEEDS_REVIEW"),mismatchCount:count("MISMATCH"),unreconciledCount:count("UNRECONCILED"),healthPercent:rows.length?Number((count("RECONCILED")/rows.length*100).toFixed(1)):null};};

const getReconciliation = async (f={}) => {const page=Math.max(1,Number(f.page||1)),limit=Math.min(100,Math.max(1,Number(f.limit||25)));const all=await Booking.find(baseQuery(f)).sort({createdAt:-1}).limit(5000).lean();const scoped=(await loadRows(all)).filter(r=>matches(r,{...f,status:""}));const rows=scoped.filter(r=>matches(r,f));const sort=f.sort||"bookingDate",dir=f.order==="asc"?1:-1;const value=(r)=>sort.split('.').reduce((v,k)=>v?.[k],r);rows.sort((a,b)=>{const av=value(a),bv=value(b);return ((sort==="amount"?n(av)-n(bv):String(av??'').localeCompare(String(bv??'')))*dir)});return{generatedAt:new Date().toISOString(),items:rows.slice((page-1)*limit,page*limit),summary:summarize(rows),counts:{all:scoped.length,payments:scoped.filter(r=>r.customerPayment.status!=="UNPAID").length,settlements:scoped.filter(r=>r.settlement.status!=="NOT_APPLICABLE").length,refunds:scoped.filter(r=>r.refund.count).length,reconciled:scoped.filter(r=>r.reconciliation.status==="RECONCILED").length,needsReview:scoped.filter(r=>r.reconciliation.status!=="RECONCILED").length},page,pageSize:limit,total:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/limit))};};
const getDetail=async id=>{const booking=await Booking.findById(id).lean();if(!booking)throw new AppError("Booking not found",404,"BOOKING_NOT_FOUND");const [row,audit]=await Promise.all([loadRows([booking]).then(x=>x[0]),AuditLog.find({entityType:"Booking",entityId:String(id)}).sort({createdAt:-1}).limit(20).lean()]);return{...row,auditTrail:audit};};
const run=async({id,auth={},requestId=""})=>{const before=await getDetail(id);await AuditLog.create({actorId:auth.id||null,actorRole:auth.role||"system",action:"booking_accounting_reconciliation_run",entityType:"Booking",entityId:id,reference:before.bookingReference,requestId,reason:"Read-only reconciliation run",after:{status:before.reconciliation.status,reasons:before.reconciliation.reasons}});return getDetail(id);};
module.exports={getReconciliation,getDetail,run,__testables:{buildRow,summarize,customerPayment}};

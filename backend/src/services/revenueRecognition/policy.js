const crypto = require('crypto');
const { toDecimal, normalizeCurrency } = require('../../utils/money');

const POLICY_ID = 'RISER_REVENUE_V1_SUPPLIER_NET';
const upper = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[ -]+/g, '_');
const id = (value) => String(value || '');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = (value) =>
  value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
const amount = (value) => {
  try {
    return toDecimal(value, { allowNegative: false }).toFixed();
  } catch {
    return null;
  }
};
const DIRECT = new Set(['DIRECT_WEBSITE', 'WEBSITE', 'BOKUN_DIRECT', 'WHATSAPP', 'WALK_IN']);
const SOURCES = new Set([
  'LOCAL_OPERATOR_CONFIRMATION',
  'DRIVER_CONFIRMATION',
  'GUIDE_CONFIRMATION',
  'ADMIN_VERIFIED',
  'BOKUN_ARRIVED',
  'OTHER_VERIFIED_SOURCE',
]);
const ISSUE =
  /CANCEL|NO_SHOW|REFUND|DISPUT|REVERSE|NEEDS_REVIEW|NEEDS_POLICY|VERIFICATION_ERROR|REJECT|FAILED/;
const approved = (evidence) =>
  evidence?.status === 'VERIFIED' &&
  Boolean(evidence.verifiedBy && date(evidence.verifiedAt) && evidence.reference);
const recognitionKey = (booking, completion) =>
  `service-revenue:${hash([id(booking._id), completion.serviceKey])}:v1`;

// No booking.amount, customer-paid or commission-percentage fallback is permitted here.
const revenueBasis = (booking = {}) => {
  const channel = upper(booking.salesChannel || booking.sourceChannel);
  const evidence = booking.bokunFinancialEvidence || {};
  if (DIRECT.has(channel)) {
    return {
      amount: amount(booking.pricingSnapshot?.finalPayable),
      currency: normalizeCurrency(booking.pricingSnapshot?.currency),
      source: 'DIRECT_BOOKING_PRICING_SNAPSHOT_FINAL_PAYABLE',
      reference: booking.bookingReference,
      kind: 'DIRECT',
    };
  }
  const seller = evidence.sellerInvoiceEvidence || {};
  const verified =
    evidence.source === 'BOKUN' &&
    evidence.status === 'VERIFIED' &&
    !(evidence.evidenceConflicts || []).length;
  return {
    amount: verified
      ? amount(
          evidence.supplierNetAmount ??
            evidence.sellerInvoiceTotal ??
            seller.sellerInvoiceTotal ??
            evidence.expectedSellerInvoiceAmount
        )
      : null,
    currency: normalizeCurrency(
      evidence.supplierNetCurrency ||
        evidence.sellerInvoiceCurrency ||
        seller.currency ||
        evidence.expectedSellerInvoiceCurrency
    ),
    source: 'VERIFIED_SUPPLIER_NET',
    kind: 'OTA',
    reference:
      evidence.evidenceHash || seller.invoiceId || evidence.expectedSellerInvoiceSource || '',
  };
};

const evaluateRevenue = ({
  booking = {},
  completion = {},
  baseCurrency = 'USD',
  now = new Date(),
} = {}) => {
  const blockers = [];
  const basis = revenueBasis(booking);
  const channel = upper(booking.salesChannel || booking.sourceChannel);
  const supplemental = completion.revenueEvidence || {};
  const verifiedSupplement = approved(supplemental);
  const completedAt = date(completion.completedAt);
  const verifiedAt = date(completion.verifiedAt);
  if (baseCurrency !== 'USD') blockers.push('BASE_CURRENCY_MUST_BE_USD');
  if (
    !booking._id ||
    id(completion.bookingId) !== id(booking._id) ||
    completion.bookingReference !== booking.bookingReference
  )
    blockers.push('COMPLETION_BOOKING_MISMATCH');
  if (
    completion.status !== 'COMPLETED' ||
    !completedAt ||
    !verifiedAt ||
    !completion.createdBy ||
    !SOURCES.has(completion.evidenceSource)
  )
    blockers.push('VERIFIED_COMPLETION_REQUIRED');
  if (
    completedAt > now ||
    verifiedAt > now ||
    (completedAt && verifiedAt && completedAt > verifiedAt)
  )
    blockers.push('COMPLETION_DATE_INVALID');
  if (completion.evidenceSource === 'ADMIN_VERIFIED' && !completion.reason)
    blockers.push('COMPLETION_REASON_REQUIRED');
  if (!completion.reason && !completion.externalReference)
    blockers.push('COMPLETION_SUPPORT_REQUIRED');
  if (completion.evidenceSource === 'BOKUN_ARRIVED' && !completion.reason)
    blockers.push('EXPLICIT_LOCAL_CONFIRMATION_REQUIRED');
  const states = [
    booking.bookingStatus,
    booking.status,
    booking.accountingStatus,
    booking.financialStatus,
    booking.paymentStatus,
    booking.bookingPaymentStatus,
    booking.bokunStatus?.normalized,
    booking.bokunStatus?.raw,
    completion.externalStatus,
    completion.evidenceSource,
    booking.bokunFinancialEvidence?.bookingStatus,
    booking.bokunFinancialEvidence?.paymentStatus,
    booking.bokunFinancialEvidence?.cancellationStatus,
  ];
  if (states.some((state) => ISSUE.test(upper(state))))
    blockers.push('CANCELLATION_REFUND_OR_EVIDENCE_REVIEW_REQUIRED');
  if (booking.cancellation?.cancelledAt) blockers.push('CANCELLATION_REVIEW_REQUIRED');
  if (
    booking.bokunFinancialEvidence?.bookingId &&
    booking.bokunBookingId &&
    id(booking.bokunFinancialEvidence.bookingId) !== id(booking.bokunBookingId)
  ) {
    blockers.push('SUPPLIER_EVIDENCE_BOOKING_MISMATCH');
  }
  if (
    [
      booking.bokunFinancialEvidence?.status,
      booking.bokunFinancialEvidence?.reconciliationStatus,
      supplemental.status,
    ].some((value) => /NEEDS_REVIEW|NEEDS_POLICY|DISPUTED/.test(upper(value)))
  )
    blockers.push('FINANCIAL_EVIDENCE_REQUIRES_REVIEW');
  if (upper(booking.bookingStatus) !== 'CONFIRMED') blockers.push('BOOKING_NOT_CONFIRMED');
  if (
    booking.bookingPaymentConflict ||
    booking.bookingPaymentPendingAudit ||
    (booking.bokunFinancialEvidence?.evidenceConflicts || []).length
  )
    blockers.push('FINANCIAL_EVIDENCE_CONFLICT');
  if (basis.amount === null || !basis.currency || !basis.reference)
    blockers.push('VERIFIED_REVENUE_BASIS_REQUIRED');

  const debtor =
    basis.kind === 'DIRECT'
      ? {
          type: 'CUSTOMER',
          id: id(
            booking.customer?.customerId ||
              (booking.customer?.firstName &&
              (booking.customer?.lastName || booking.customer?.email || booking.customer?.phone)
                ? `BOOKING_CUSTOMER:${booking.bookingReference}`
                : '')
          ),
          mappingKey: 'ACCOUNTS_RECEIVABLE',
        }
      : {
          type: 'OTA',
          id: ['GETYOURGUIDE', 'VIATOR'].includes(channel)
            ? channel
            : id(booking.bokunFinancialEvidence?.marketplaceResellerId),
          mappingKey:
            channel === 'GETYOURGUIDE'
              ? 'GYG_RECEIVABLE'
              : channel === 'VIATOR'
                ? 'VIATOR_RECEIVABLE'
                : 'OTA_RECEIVABLE',
        };
  if (!debtor.id) blockers.push('RECEIVABLE_PARTY_REQUIRED');

  let originalAmount = basis.amount;
  let allocation = null;
  const raw = booking.rawBokunResponse || booking.bokunFinancialEvidence?.raw?.booking || {};
  const activities = raw.activityBookings || raw.booking?.activityBookings || [];
  const packageBooking =
    activities.length > 1 ||
    /PACKAGE|MULTI_SERVICE/.test(
      upper(booking.serviceType || booking.productType || booking.productTitle)
    );
  if (supplemental.components?.length) {
    allocation = supplemental.components
      .map((item) => ({ serviceKey: id(item.serviceKey), amount: amount(item.amount) }))
      .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));
    const keys = allocation.map((item) => item.serviceKey);
    const valid =
      verifiedSupplement &&
      basis.amount !== null &&
      allocation.every((item) => item.serviceKey && item.amount !== null) &&
      new Set(keys).size === keys.length;
    const sum = valid
      ? allocation.reduce((total, item) => total.plus(item.amount), toDecimal(0))
      : null;
    const component = allocation.find((item) => item.serviceKey === completion.serviceKey);
    if (!valid || !sum?.eq(basis.amount) || !component || (packageBooking && allocation.length < 2))
      blockers.push('VERIFIED_COMPONENT_ALLOCATION_REQUIRED');
    originalAmount = component?.amount ?? null;
  } else if (
    packageBooking ||
    !completion.serviceKey ||
    completion.serviceKey !== id(booking.bokunProductId)
  ) {
    blockers.push('VERIFIED_COMPONENT_ALLOCATION_REQUIRED');
  }
  const allocationHash = hash(
    allocation || [{ serviceKey: completion.serviceKey, amount: basis.amount }]
  );
  let fx = {
    rate: '1',
    source: 'SAME_CURRENCY',
    date: completedAt?.toISOString().slice(0, 10) || null,
    fromCurrency: basis.currency,
    toCurrency: 'USD',
  };
  let usdAmount = originalAmount === null ? null : toDecimal(originalAmount).toFixed(2);
  if (basis.currency && basis.currency !== 'USD') {
    fx = supplemental.fx || {};
    const fxDate = date(fx.date);
    const rate = amount(fx.rate);
    if (
      !verifiedSupplement ||
      !rate ||
      toDecimal(rate).lte(0) ||
      !fx.source ||
      !fxDate ||
      fx.fromCurrency !== basis.currency ||
      fx.toCurrency !== 'USD' ||
      fxDate.toISOString().slice(0, 10) !== completedAt?.toISOString().slice(0, 10)
    ) {
      blockers.push('VERIFIED_RECOGNITION_DATE_FX_REQUIRED');
      usdAmount = null;
    } else {
      fx = {
        ...fx,
        rate,
        date: fxDate.toISOString().slice(0, 10),
        reference: supplemental.reference,
        verifiedBy: supplemental.verifiedBy,
      };
      usdAmount = originalAmount === null ? null : toDecimal(originalAmount).times(rate).toFixed(2);
    }
  }
  if (originalAmount !== null && toDecimal(originalAmount).gt(0) && usdAmount === '0.00')
    blockers.push('AMOUNT_ROUNDS_TO_ZERO');
  const status = blockers.includes('VERIFIED_RECOGNITION_DATE_FX_REQUIRED')
    ? 'NEEDS_REVIEW_FX'
    : blockers.length
      ? 'NEEDS_REVIEW'
      : toDecimal(originalAmount).isZero()
        ? 'ZERO_REVENUE'
        : 'READY';
  return {
    eligible: !blockers.length,
    status,
    blockers: [...new Set(blockers)],
    policyId: POLICY_ID,
    postingKey: recognitionKey(booking, completion),
    serviceKey: completion.serviceKey,
    originalAmount,
    originalCurrency: basis.currency,
    usdAmount,
    fx,
    basis,
    debtor,
    allocationHash,
    allocation,
    recognitionDate: completedAt,
    revenueMappingKey: /TRANSFER/.test(upper(completion.serviceName || booking.productTitle))
      ? 'TRANSFER_REVENUE'
      : 'TOUR_REVENUE',
    commissionExpense: '0',
    cashReceived: false,
  };
};

const activationBlockers = ({ config, completion, now = new Date() }) => {
  const start = date(config.REVENUE_RECOGNITION_ACTIVATED_AT);
  const scope = config.REVENUE_RECOGNITION_ACTIVATION_SCOPE;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(
      config.REVENUE_RECOGNITION_ACTIVATED_AT || ''
    ) ||
    !start ||
    start > now ||
    scope !== 'NEW_COMPLETIONS'
  )
    return ['ACTIVATION_BOUNDARY_REQUIRED'];
  const timestamps = [completion.createdAt, completion.verifiedAt, completion.completedAt];
  return timestamps.some((value) => !date(value) || date(value) <= start)
    ? ['OUTSIDE_ACTIVATION_BOUNDARY']
    : [];
};
module.exports = {
  POLICY_ID,
  evaluateRevenue,
  revenueBasis,
  recognitionKey,
  activationBlockers,
  approved,
  amount,
  hash,
};

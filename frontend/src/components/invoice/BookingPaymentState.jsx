import { dateLabel, invoiceMoney } from './invoiceView.js';
import './bookingPaymentState.css';

const paymentLabels = {
  PAID: ['Customer paid', 'positive'],
  PARTIALLY_PAID: ['Partially paid', 'attention'],
  PARTIAL: ['Partially paid', 'attention'],
  UNPAID: ['Unpaid', 'attention'],
  REFUNDED: ['Refunded', 'neutral'],
  PARTIALLY_REFUNDED: ['Partially refunded', 'neutral']
};
const settlementLabels = {
  PENDING: ['Settlement pending', 'attention'],
  PARTIALLY_RECEIVED: ['Settlement partially received', 'attention'],
  RECEIVED: ['Settlement received', 'positive'],
  RECONCILED: ['Settlement reconciled', 'positive'],
  DISPUTED: ['Settlement disputed', 'negative'],
  NOT_APPLICABLE: ['Settlement not applicable', 'neutral']
};

export function PaymentTruthBadge({ payment }) {
  const [label, tone] = paymentLabels[payment?.status] || ['Payment status unavailable', 'neutral'];
  return <span className="bpt-state">
    <span className={`bpt-badge bpt-${tone}`}>{label}</span>
    {payment?.stale && <span className="bpt-warning">Sync may be outdated</span>}
    {payment?.conflict && <span className="bpt-warning">Payment conflict — review required</span>}
  </span>;
}

export function SettlementBadge({ settlement }) {
  const [label, tone] = settlementLabels[settlement?.status] || ['Settlement unavailable', 'neutral'];
  return <span className={`bpt-badge bpt-${tone}`}>{label}</span>;
}

function ReceivedAmounts({ settlement }) {
  const amounts = settlement?.receivedByCurrency;
  if (Array.isArray(amounts) && amounts.length) {
    return <span className="bpt-amounts">{amounts.map((entry, index) => <span key={`${entry.currency}-${index}`}>{invoiceMoney(entry.amount, entry.currency)}</span>)}</span>;
  }
  if (settlement?.receivedAmount === null || settlement?.receivedAmount === undefined) return 'Unavailable';
  return invoiceMoney(settlement.receivedAmount, settlement.currency);
}

export function PaymentTruthDetails({ record = {} }) {
  const payment = record.bookingPayment;
  const settlement = record.settlement;
  const cashReceipt = settlement?.cashReceipt || record.cashReceipt;
  const reconciliation = settlement?.reconciliation || record.reconciliation;
  return <section className="bpt-details" aria-label="Customer payment and local settlement">
    <h3>Customer Payment &amp; Settlement</h3>
    <dl className="bpt-facts">
      <div><dt>Customer payment</dt><dd><PaymentTruthBadge payment={payment} /></dd></div>
      <div><dt>Sales channel</dt><dd>{record.salesChannel || 'Unavailable'}</dd></div>
      <div><dt>Reported paid amount</dt><dd>{payment?.reportedPaidAmount === null || payment?.reportedPaidAmount === undefined ? 'Unavailable' : invoiceMoney(payment.reportedPaidAmount, payment.currency)}</dd></div>
      <div><dt>Last payment sync</dt><dd>{payment?.syncedAt ? dateLabel(payment.syncedAt, 'Africa/Dar_es_Salaam', { hour: '2-digit', minute: '2-digit' }) : 'Unavailable'}</dd></div>
      <div><dt>Local settlement</dt><dd><SettlementBadge settlement={settlement} /></dd></div>
      <div><dt>Settlement received</dt><dd><ReceivedAmounts settlement={settlement} /></dd></div>
      <div><dt>Cash receipt</dt><dd>{cashReceipt?.status === 'CONFIRMED' ? 'Confirmed local receipt' : cashReceipt?.status === 'NONE' ? 'No local receipt recorded' : 'Unavailable'}</dd></div>
      <div><dt>Bank reconciliation</dt><dd>{reconciliation?.supported && reconciliation.status === 'RECONCILED' ? 'Reconciled' : 'Unavailable — payment review does not confirm bank reconciliation'}</dd></div>
    </dl>
    <p className="bpt-note">Customer payment and local cash receipt are separate. A channel-reported payment does not confirm a payout to Riser.</p>
    {payment?.conflict && <p className="bpt-review">Review the payment source before requesting another customer payment.</p>}
  </section>;
}

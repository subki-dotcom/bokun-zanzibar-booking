import { useCallback } from 'react';
import axiosClient from '../../api/axiosClient';
import useReportResource from '../admin/reportCenter/useReportResource';
import { humanize } from './invoiceView';
import './bookingPaymentState.css';

export default function BookingPaymentOverview({ query = {}, analytics = false, refreshKey = 0 }) {
  const queryKey = JSON.stringify(Object.fromEntries(Object.entries(query).filter(([, value]) => value !== "" && value != null)));
  const fetcher = useCallback(async () => (await axiosClient.get(`/admin/${analytics ? 'analytics' : 'booking-accounting'}/booking-payment`, { params: JSON.parse(queryKey) })).data.data, [queryKey, analytics, refreshKey]);
  const resource = useReportResource(fetcher);
  return <section className="bpt-overview" aria-label="Customer payment and settlement" aria-busy={resource.loading}><h2>Customer Payment &amp; Settlement</h2>
    {resource.loading ? <p role="status">Loading payment overview…</p> : resource.error ? <div role="alert"><p>{resource.error}</p><button type="button" onClick={resource.retry}>Retry payment overview</button></div> : !resource.data?.channels?.length ? <p>No bookings in this period.</p> : <><div className="bpt-overview-scroll" role="region" aria-label="Payment status by channel" tabIndex={0}><table><thead><tr>{['Channel', 'Customer paid', 'Partially paid', 'Unpaid', 'Refunded', 'Unknown', 'Settlement received', 'Settlement pending'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{resource.data.channels.map(row => <tr key={row.channel}><th>{humanize(row.channel)}</th>{['paid', 'partiallyPaid', 'unpaid', 'refunded', 'unknown', 'settlementReceived', 'settlementPending'].map(key => <td key={key}>{row[key]}</td>)}</tr>)}</tbody></table></div><p>{resource.data.basis}</p><p>Bank reconciliation status/rate is unavailable from the current settlement records. A payment review does not prove reconciliation.</p></>}
  </section>;
}

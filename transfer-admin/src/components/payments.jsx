import { useState } from "react";
import { Alert, Badge, Button, Card, Table } from "react-bootstrap";
import { fetchBookingPayments, recheckPayment } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { dateTime, usd } from "../lib/format";
import { P, can } from "../lib/permissions";
import { ErrorMessage, Loading, useResource } from "./ui";

const PAYMENT_STATE = Object.freeze({
  PENDING: { label: "Waiting for Pesapal", bg: "warning", text: "dark" },
  PAID: { label: "Paid", bg: "success" },
  FAILED: { label: "Failed", bg: "secondary" },
  CANCELLED: { label: "Cancelled", bg: "secondary" },
  REVERSED: { label: "Reversed", bg: "danger" }
});

export const ALERTS = Object.freeze({
  NEEDS_REFUND: "Needs refund",
  PAYMENT_REVERSED: "Payment reversed"
});

export const PaymentAlertBadge = ({ alert }) => (alert ? <Badge bg="danger" className="ms-1">{ALERTS[alert] || alert}</Badge> : null);

// Why staff must act, shown at the top of a booking with a payment alert.
export const PaymentAlertNotice = ({ alert }) => {
  if (!alert) return null;
  return (
    <Alert variant="danger" role="alert">
      <strong>{ALERTS[alert] || alert}.</strong>{" "}
      {alert === "NEEDS_REFUND"
        ? "Pesapal received money for this booking that could not be applied (already paid, rejected or cancelled, or a different amount). Refund it in the Pesapal dashboard; see the payments below."
        : "Pesapal reversed a payment that had confirmed this booking. Check the booking with the customer and in the Pesapal dashboard."}
    </Alert>
  );
};

// Every Pesapal attempt for a booking, read from the server. Staff can ask Pesapal again for an attempt; nobody can
// mark a payment paid by hand.
export const BookingPayments = ({ bookingId, onChanged }) => {
  const { user } = useAuth();
  const { data, loading, error, reload } = useResource(() => fetchBookingPayments(bookingId), [bookingId]);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState(null);
  const manage = can(user, P.PAYMENTS_MANAGE);

  const recheck = async (payment) => {
    setActionError(null);
    setBusy(payment.id);
    try {
      await recheckPayment(bookingId, payment.id);
      await reload();
      await onChanged?.();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="ta-card mb-3">
      <Card.Body>
        <h2 className="h6">Payments (Pesapal)</h2>
        <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
        {loading && !data ? <Loading /> : null}
        {data && !data.length ? <p className="small text-muted mb-0">No payment attempts yet.</p> : null}
        {data?.length ? (
          <Table size="sm" responsive className="mb-0 align-middle">
            <tbody>
              {data.map((payment) => {
                const state = PAYMENT_STATE[payment.status] || { label: payment.status, bg: "secondary" };
                return (
                  <tr key={payment.id}>
                    <td>
                      <Badge bg={state.bg} text={state.text}>{state.label}</Badge>
                      {payment.outcome === "NEEDS_REFUND" ? <Badge bg="danger" className="ms-1">Needs refund</Badge> : null}
                      <div className="small text-muted">{dateTime(payment.createdAt)} · {payment.merchantReference}</div>
                      {payment.confirmationCode ? <div className="small">Pesapal code {payment.confirmationCode}{payment.paymentMethod ? ` · ${payment.paymentMethod}` : ""}</div> : null}
                      {payment.outcomeReason ? <div className="small text-danger">{payment.outcomeReason}</div> : null}
                      {payment.failureReason && payment.status !== "PAID" ? <div className="small text-muted">{payment.failureReason}</div> : null}
                      {payment.lastCheckedAt ? <div className="small text-muted">Last checked {dateTime(payment.lastCheckedAt)}</div> : null}
                    </td>
                    <td className="text-end text-nowrap">
                      {usd(payment.amount)}
                      {manage && payment.orderTrackingId ? (
                        <div><Button size="sm" variant="outline-secondary" className="mt-1" disabled={busy === payment.id} onClick={() => recheck(payment)}>{busy === payment.id ? "Checking…" : "Check with Pesapal"}</Button></div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}
      </Card.Body>
    </Card>
  );
};

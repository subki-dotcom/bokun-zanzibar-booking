import { useEffect, useMemo, useState } from "react";
import { confirmAction, useToastMessage } from "../../components/admin/ui/feedback";
import { Alert, Button } from "react-bootstrap";
import { BsArrowClockwise, BsExclamationTriangle, BsHourglassSplit, BsListCheck, BsShieldCheck, BsTrash } from "react-icons/bs";
import { fetchPendingFinalizations, reconcileBookingFinalizations, retryBookingFinalization } from "../../api/adminApi";
import { adminCancelBooking } from "../../api/bookingsApi";
import { AdminPage, DataTable, EmptyState, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from "../../components/admin/ui";
import { formatAdminDate, formatAdminMoney } from "../../utils/adminFormat";

const AdminRecoveryPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useToastMessage(notice, setNotice);

  const load = async ({ force = false } = {}) => {
    setError("");
    try {
      const data = await fetchPendingFinalizations({ limit: 50, includeProcessing: true, force });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load recovery queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const paidPending = items.filter((item) => item.paymentStatus === "paid" && !item.bokunBookingId).length;
    const failed = items.filter((item) => item.finalization?.status === "failed").length;
    return { paidPending, failed, total: items.length };
  }, [items]);

  const retry = async (bookingId) => {
    setBusyId(bookingId);
    setNotice("");
    setError("");
    try {
      await retryBookingFinalization(bookingId, { force: true });
      setNotice("Retry executed. Queue refreshed.");
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Retry failed");
    } finally {
      setBusyId("");
    }
  };

  const reconcile = async () => {
    setBusyId("reconcile");
    setNotice("");
    setError("");
    try {
      const result = await reconcileBookingFinalizations({ limit: 50, force: true });
      setNotice(`Reconcile complete: ${result?.summary?.confirmed || 0} confirmed, ${result?.summary?.pendingRetry || 0} pending retry.`);
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Reconcile failed");
    } finally {
      setBusyId("");
    }
  };

  const cancel = async (bookingId, reference) => {
    const ok = await confirmAction({ title: `Cancel booking ${reference}?`, message: "This also requests the cancellation in Bókun when the booking has a Bókun ID.", confirmLabel: "Cancel booking", cancelLabel: "Keep booking" });
    if (!ok) return;

    setBusyId(bookingId);
    setNotice("");
    setError("");
    try {
      await adminCancelBooking(bookingId, "Cancelled from recovery dashboard");
      setNotice(`Booking ${reference} cancelled.`);
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Cancellation failed");
    } finally {
      setBusyId("");
    }
  };

  const columns = [
    { key: "reference", header: "Reference", render: (item) => <strong>{item.bookingReference}</strong> },
    {
      key: "product",
      header: "Tour",
      render: (item) => (
        <>
          <span className="d-block">{item.productTitle}</span>
          <small className="text-muted">{formatAdminDate(item.travelDate)} {item.startTime || ""}</small>
        </>
      )
    },
    { key: "payment", header: "Payment", render: (item) => <StatusBadge value={item.paymentStatus} /> },
    {
      key: "bokun",
      header: "Bókun",
      render: (item) => (item.bokunBookingId
        ? <StatusBadge value="confirmed" label={`Confirmed · ${item.bokunBookingId}`} />
        : <StatusBadge value="pending" label="Not confirmed yet" />)
    },
    { key: "amount", header: "Amount", money: true, render: (item) => formatAdminMoney(item.amount || 0, item.currency || "USD") },
    { key: "error", header: "Last error", render: (item) => <span className="admin-recovery-error">{item.finalization?.lastError?.message || item.finalization?.status || "—"}</span> },
  ];

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Operations"
        title="Recovery Center"
        description="Paid bookings that still need a Bókun confirmation, or a person to step in."
        actions={
          <Button variant="primary" onClick={reconcile} disabled={busyId === "reconcile"}>
            <BsArrowClockwise aria-hidden="true" /> {busyId === "reconcile" ? "Reconciling" : "Reconcile now"}
          </Button>
        }
      />


      <StatGrid columns={3}>
        <StatCard label="In the queue" value={stats.total} icon={BsListCheck} loading={loading} />
        <StatCard label="Paid, not confirmed in Bókun" value={stats.paidPending} icon={BsHourglassSplit} loading={loading} status={stats.paidPending ? "pending" : ""} />
        <StatCard label="Failed confirmations" value={stats.failed} icon={BsExclamationTriangle} loading={loading} status={stats.failed ? "failed" : ""} />
      </StatGrid>

      <SectionCard title="Recovery queue">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(item) => item.bookingId}
          rowActions={(item) => [
            { label: "Retry Bókun confirmation", icon: BsArrowClockwise, disabled: busyId === item.bookingId, onClick: () => retry(item.bookingId) },
            { label: "Cancel booking", icon: BsTrash, danger: true, disabled: busyId === item.bookingId, onClick: () => cancel(item.bookingId, item.bookingReference) }
          ]}
          loading={loading}
          error={error}
          onRetry={() => load({ force: true })}
          caption="Recovery queue"
          empty={<EmptyState icon={BsShieldCheck} title="Nothing to recover" message="Every paid booking is confirmed in Bókun." />}
        />
      </SectionCard>
    </AdminPage>
  );
};

export default AdminRecoveryPage;

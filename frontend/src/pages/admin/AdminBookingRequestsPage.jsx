import { useEffect, useMemo, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { BsArrowClockwise, BsClipboard2Check, BsCreditCard, BsExclamationTriangle, BsEye, BsHourglassSplit } from "react-icons/bs";
import { Link } from "react-router-dom";
import { fetchAdminBookingRequests } from "../../api/bookingRequestsApi";
import { AdminPage, DataTable, EmptyState, FilterBar, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from "../../components/admin/ui";
import { formatAdminDate, formatAdminMoney } from "../../utils/adminFormat";
import { formatLabel } from "../../utils/formatLabel";

const AdminBookingRequestsPage = () => {
  const [filters, setFilters] = useState({ status: "", type: "", search: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminBookingRequests({ ...nextFilters, limit: 150 });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load booking requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter((row) => ["submitted", "under_review", "awaiting_availability_check"].includes(row.status)).length,
    payment: rows.filter((row) => row.status === "awaiting_additional_payment").length,
    supplier: rows.filter((row) => ["failed", "manual_action_required"].includes(row.bokunSync?.status)).length
  }), [rows]);

  const submitFilters = (event) => {
    event.preventDefault();
    load(filters);
  };

  const columns = [
    { key: "request", header: "Request", render: (row) => (<><strong className="d-block">{row.requestReference}</strong><small className="text-muted">{formatLabel(row.type)}</small></>) },
    {
      key: "booking",
      header: "Booking / customer",
      render: (row) => (
        <>
          <strong className="d-block">{row.booking?.bookingReference || "—"}</strong>
          <small className="text-muted">{[row.booking?.customer?.firstName, row.booking?.customer?.lastName].filter(Boolean).join(" ") || row.booking?.customer?.email || ""}</small>
        </>
      )
    },
    { key: "tour", header: "Tour", render: (row) => row.booking?.productTitle || "—" },
    { key: "travelDate", header: "Travel date", render: (row) => formatAdminDate(row.booking?.travelDate) },
    { key: "paid", header: "Paid", money: true, render: (row) => formatAdminMoney(row.booking?.invoiceSnapshot?.amountPaid || 0, row.booking?.currency || "USD") },
    {
      key: "difference",
      header: "Difference",
      money: true,
      render: (row) => (row.priceAdjustment?.difference === null || row.priceAdjustment?.difference === undefined ? "—" : formatAdminMoney(row.priceAdjustment.difference, row.originalSnapshot?.currency || "USD"))
    },
    { key: "refund", header: "Refund", money: true, render: (row) => formatAdminMoney(row.refund?.estimatedAmount || 0, row.originalSnapshot?.currency || "USD") },
    { key: "status", header: "Request", render: (row) => <StatusBadge value={row.status} /> },
    { key: "supplier", header: "Supplier", render: (row) => <StatusBadge value={row.bokunSync?.status} /> },
    {
      key: "view",
      header: "",
      align: "end",
      render: (row) => (
        <Button as={Link} to={`/admin/booking-requests/${row._id}`} size="sm" variant="outline-primary" aria-label={`View ${row.requestReference}`}>
          <BsEye aria-hidden="true" /> View
        </Button>
      )
    }
  ];

  const resetFilters = () => {
    const empty = { status: "", type: "", search: "" };
    setFilters(empty);
    load(empty);
  };

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Operations"
        title="Booking Requests"
        description="Customer reschedules, traveller changes, cancellations and refunds, and their sync with the supplier."
        actions={
          <Button variant="outline-secondary" onClick={() => load()} disabled={loading}>
            <BsArrowClockwise aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <StatGrid columns={4}>
        <StatCard label="All requests" value={stats.total} icon={BsClipboard2Check} loading={loading} />
        <StatCard label="Waiting for review" value={stats.pending} icon={BsHourglassSplit} loading={loading} />
        <StatCard label="Extra payment due" value={stats.payment} icon={BsCreditCard} loading={loading} />
        <StatCard label="Supplier needs attention" value={stats.supplier} icon={BsExclamationTriangle} loading={loading} status={stats.supplier ? "warning" : ""} />
      </StatGrid>

      <SectionCard title="Requests">
        <Form onSubmit={submitFilters} className="mb-3">
          <FilterBar
            search={{ value: filters.search, onChange: (value) => setFilters((current) => ({ ...current, search: value })), placeholder: "Booking reference, customer, email or Bókun reference" }}
            onReset={resetFilters}
            actions={<Button type="submit" variant="primary" size="sm">Apply</Button>}
          >
            <Form.Select size="sm" aria-label="Request type" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="">All types</option><option value="reschedule">Reschedule</option><option value="change_travelers">Traveller change</option><option value="cancel_booking">Cancellation</option><option value="combined_change">Combined change</option>
            </Form.Select>
            <Form.Select size="sm" aria-label="Request status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="awaiting_additional_payment">Additional payment</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="failed">Failed</option>
            </Form.Select>
          </FilterBar>
        </Form>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row._id}
          loading={loading}
          error={error}
          onRetry={() => load()}
          pageSize={25}
          caption="Booking requests"
          empty={
            <EmptyState
              icon={BsClipboard2Check}
              title="No booking requests"
              message="When a guest asks to change or cancel a booking from My booking, the request appears here for review."
            />
          }
        />
      </SectionCard>
    </AdminPage>
  );
};

export default AdminBookingRequestsPage;

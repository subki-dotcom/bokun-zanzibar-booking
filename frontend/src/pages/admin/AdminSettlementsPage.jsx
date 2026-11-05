import { useEffect, useState } from "react";
import { Alert, Button, Form, Offcanvas } from "react-bootstrap";
import { BsArrowClockwise, BsCashCoin, BsCloudArrowUp, BsExclamationTriangle, BsInboxes, BsPlusLg, BsReceipt } from "react-icons/bs";
import { Link } from "react-router-dom";
import { createSettlement, fetchSettlements } from "../../api/adminApi";
import { AdminPage, DataTable, EmptyState, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from "../../components/admin/ui";
import { formatAdminDate, formatAdminMoney } from "../../utils/adminFormat";
import { formatLabel } from "../../utils/formatLabel";

const PROVIDERS = ["GETYOURGUIDE", "VIATOR", "PESAPAL", "DPO", "PAYPAL", "BANK", "MANUAL", "OTHER"];
const emptyForm = () => ({ settlementReference: "", provider: "GETYOURGUIDE", providerSettlementReference: "", receivedAmount: "", receivedCurrency: "USD", settlementDate: "", evidenceSource: "MANUAL_VERIFIED", evidenceReference: "" });
// Unavailable values are labelled, never shown as a misleading zero.
const money = (value, currency) => (value == null || !currency ? "Not available" : formatAdminMoney(value, currency));

export default function AdminSettlementsPage() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      setState({ loading: false, error: "", data: await fetchSettlements({ limit: 100 }) });
    } catch (error) {
      setState({ loading: false, error: error.message || "Unable to load settlements.", data: null });
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await createSettlement(form);
      setForm(emptyForm());
      setShowForm(false);
      setNotice("Settlement evidence recorded.");
      await load();
    } catch (error) {
      setFormError(error.message || "Unable to record settlement evidence.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = state.data?.items || [];
  const set = (key) => (event) => setForm({ ...form, [key]: key === "receivedCurrency" ? event.target.value.toUpperCase() : event.target.value });

  const columns = [
    {
      key: "settlementReference",
      header: "Settlement reference",
      render: (row) => (
        <>
          <Link to={`/admin/business-accounting/settlements/${row._id}`}>{row.settlementReference}</Link>
          <small className="d-block text-muted fw-normal">{row.providerSettlementReference || "No provider reference"}</small>
        </>
      )
    },
    { key: "provider", header: "Provider", render: (row) => formatLabel(row.provider) },
    { key: "settlementDate", header: "Date", render: (row) => formatAdminDate(row.settlementDate) },
    { key: "currency", header: "Currency", hideOnMobile: true, render: (row) => row.expectedNet?.currency || row.received?.currency || "—" },
    { key: "expected", header: "Expected", money: true, render: (row) => money(row.expectedNet?.amount, row.expectedNet?.currency) },
    { key: "received", header: "Received", money: true, render: (row) => money(row.received?.amount, row.received?.currency) },
    { key: "allocated", header: "Allocated", money: true, hideOnMobile: true, render: (row) => money(row.allocated?.amount, row.allocated?.currency) },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "evidence", header: "Evidence", hideOnMobile: true, render: (row) => formatLabel(row.evidenceSource) }
  ];

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Business Accounting"
        title="Settlements"
        description="What OTAs and payment providers actually paid out to you, tracked separately from what guests paid."
        actions={
          <>
            <Button variant="outline-secondary" onClick={load} disabled={state.loading}>
              <BsArrowClockwise aria-hidden="true" /> Refresh
            </Button>
            <Link className="btn btn-outline-secondary" to="/admin/business-accounting/settlements/import">
              <BsCloudArrowUp aria-hidden="true" /> Import statement
            </Link>
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <BsPlusLg aria-hidden="true" /> Record payout
            </Button>
          </>
        }
      />

      {notice ? <Alert variant="success" className="mb-0" dismissible onClose={() => setNotice("")}>{notice}</Alert> : null}

      <StatGrid columns={4}>
        <StatCard label="Records" value={state.data?.total ?? 0} icon={BsInboxes} loading={state.loading} />
        <StatCard label="With an expected amount" value={rows.filter((row) => row.expectedNet).length} icon={BsReceipt} loading={state.loading} />
        <StatCard label="Received" value={rows.filter((row) => row.received).length} icon={BsCashCoin} loading={state.loading} />
        <StatCard
          label="Needs review"
          value={rows.filter((row) => ["NEEDS_REVIEW", "MISMATCH"].includes(row.status)).length}
          icon={BsExclamationTriangle}
          loading={state.loading}
        />
      </StatGrid>

      <SectionCard title="Settlement evidence">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row._id}
          loading={state.loading}
          error={state.error}
          onRetry={load}
          pageSize={25}
          caption="Settlements"
          empty={
            <EmptyState
              icon={BsCashCoin}
              title="No payouts recorded yet"
              message="Record a payout when an OTA or provider pays you, or import their statement."
              action={<Button size="sm" onClick={() => setShowForm(true)}><BsPlusLg aria-hidden="true" /> Record payout</Button>}
            />
          }
        />
      </SectionCard>

      <Offcanvas show={showForm} onHide={() => setShowForm(false)} placement="end" className="adm-drawer">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Record payout</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Form onSubmit={submit} className="d-grid gap-3">
            <p className="text-muted mb-0">Settlement evidence for money an OTA or provider paid out. It does not change what the guest paid.</p>
            {formError ? <Alert variant="danger" className="mb-0">{formError}</Alert> : null}
            <Form.Group controlId="settlement-reference">
              <Form.Label>Settlement reference</Form.Label>
              <Form.Control required value={form.settlementReference} onChange={set("settlementReference")} />
            </Form.Group>
            <Form.Group controlId="settlement-provider">
              <Form.Label>Provider</Form.Label>
              <Form.Select value={form.provider} onChange={set("provider")}>
                {PROVIDERS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </Form.Select>
            </Form.Group>
            <div className="row g-2">
              <Form.Group className="col-8" controlId="settlement-amount">
                <Form.Label>Received amount</Form.Label>
                <Form.Control type="number" min="0" step="0.01" value={form.receivedAmount} onChange={set("receivedAmount")} />
              </Form.Group>
              <Form.Group className="col-4" controlId="settlement-currency">
                <Form.Label>Currency</Form.Label>
                <Form.Control maxLength={3} required value={form.receivedCurrency} onChange={set("receivedCurrency")} />
              </Form.Group>
            </div>
            <Form.Group controlId="settlement-evidence">
              <Form.Label>Evidence reference</Form.Label>
              <Form.Control required value={form.evidenceReference} onChange={set("evidenceReference")} placeholder="Bank reference, payout ID…" />
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 pt-2">
              <Button variant="outline-secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Record payout"}</Button>
            </div>
          </Form>
        </Offcanvas.Body>
      </Offcanvas>
    </AdminPage>
  );
}

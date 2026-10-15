import { useState } from "react";
import { Badge, Button, Card, Form, Table } from "react-bootstrap";
import { createZone, deleteZone, fetchZones, updateZone } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { P, can } from "../lib/permissions";

const ZoneModal = ({ zone, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? zone?.[field] ?? fallback;
  const submit = async () => {
    const body = { code: value("code"), name: value("name"), description: value("description") };
    if (zone) await updateZone(zone.id, { ...body, reason: form.reason || undefined });
    else await createZone(body);
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={zone ? `Edit zone ${zone.code}` : "New zone"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Form.Group className="mb-3" controlId="zone-code"><Form.Label>Code</Form.Label><Form.Control value={value("code")} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={20} pattern="[A-Za-z0-9_-]+" required /></Form.Group>
      <Form.Group className="mb-3" controlId="zone-name"><Form.Label>Name</Form.Label><Form.Control value={value("name")} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={100} required /></Form.Group>
      <Form.Group className="mb-3" controlId="zone-description"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={value("description")} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} /></Form.Group>
      {zone ? <Form.Group controlId="zone-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

// Deleting removes the zone with its locations, routes and rates. The server refuses it while bookings use the zone.
const DeleteZoneModal = ({ zone, onHide, onDeleted }) => {
  const [confirmCode, setConfirmCode] = useState("");
  const [reason, setReason] = useState("");
  const submit = async () => {
    await deleteZone(zone.id, { confirmCode, reason: reason || undefined });
    onDeleted();
  };
  return (
    <FormModal show={Boolean(zone)} title={`Delete zone ${zone?.code || ""}`} submitLabel="Delete zone" variant="danger" onHide={onHide} onSubmit={submit}>
      <p>This permanently deletes <strong>{zone?.name}</strong> together with all its locations, routes and rates. It cannot be undone.</p>
      <p className="small text-muted">A zone used by bookings cannot be deleted; deactivate it instead.</p>
      <Form.Group className="mb-3" controlId="zone-delete-code"><Form.Label>Type <strong>{zone?.code}</strong> to confirm</Form.Label><Form.Control value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} maxLength={20} autoComplete="off" required /></Form.Group>
      <Form.Group controlId="zone-delete-reason"><Form.Label>Reason (optional)</Form.Label><Form.Control value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Form.Group>
    </FormModal>
  );
};

const ZonesPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const { data, loading, error, reload } = useResource(() => fetchZones(), []);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [actionError, setActionError] = useState(null);

  const toggle = async (zone) => {
    setActionError(null);
    try {
      await updateZone(zone.id, { active: !zone.active, reason: zone.active ? "Deactivated from the zones list" : "Reactivated from the zones list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Zones" subtitle="Areas used for pricing. Each location belongs to one zone." actions={manage ? <Button size="sm" onClick={() => setEditing("new")}>New zone</Button> : null} />
      <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Code</th><th>Name</th><th>Description</th><th>Status</th>{manage ? <th aria-label="Actions" /> : null}</tr></thead>
              <tbody>
                {data.map((zone) => (
                  <tr key={zone.id}>
                    <td><strong>{zone.code}</strong></td>
                    <td>{zone.name}</td>
                    <td className="small">{zone.description}</td>
                    <td>{zone.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    {manage ? (
                      <td className="text-end text-nowrap">
                        <Button size="sm" variant="outline-secondary" onClick={() => setEditing(zone)}>Edit</Button>{" "}
                        <Button size="sm" variant={zone.active ? "outline-danger" : "outline-success"} onClick={() => toggle(zone)}>{zone.active ? "Deactivate" : "Activate"}</Button>{" "}
                        <Button size="sm" variant="danger" onClick={() => setDeleting(zone)}>Delete</Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No zones yet.{manage ? " Create the first zone to start pricing." : ""}</Empty>
        )
      ) : null}
      <ZoneModal key={editing?.id || editing || "none"} zone={editing && editing !== "new" ? editing : null} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
      <DeleteZoneModal key={deleting?.id || "none-delete"} zone={deleting} onHide={() => setDeleting(null)} onDeleted={reload} />
    </>
  );
};

export default ZonesPage;

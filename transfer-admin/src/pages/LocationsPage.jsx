import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { createLocation, fetchLocations, fetchZones, updateLocation } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, Pager, useResource } from "../components/ui";
import { LOCATION_TYPES } from "../lib/format";
import { P, can } from "../lib/permissions";

const LocationModal = ({ location, zones, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? location?.[field] ?? fallback;
  const submit = async () => {
    const body = {
      name: value("name"),
      type: value("type", "HOTEL"),
      zoneId: value("zoneId"),
      address: value("address"),
      aliases: String(form.aliases ?? (location?.aliases || []).join(", ")).split(",").map((alias) => alias.trim()).filter(Boolean),
      sortOrder: Number(value("sortOrder", 0)) || 0
    };
    if (location) await updateLocation(location.id, { ...body, reason: form.reason || undefined });
    else await createLocation(body);
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={location ? `Edit ${location.name}` : "New location"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Form.Group className="mb-3" controlId="loc-name"><Form.Label>Name (shown to customers)</Form.Label><Form.Control value={value("name")} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={150} required /></Form.Group>
      <Row className="g-3 mb-3">
        <Col sm={6}>
          <Form.Group controlId="loc-type"><Form.Label>Type</Form.Label>
            <Form.Select value={value("type", "HOTEL")} onChange={(event) => setForm({ ...form, type: event.target.value })}>{LOCATION_TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</Form.Select>
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group controlId="loc-zone"><Form.Label>Zone</Form.Label>
            <Form.Select value={value("zoneId")} onChange={(event) => setForm({ ...form, zoneId: event.target.value })} required>
              <option value="">Select…</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}{zone.active ? "" : " (inactive)"}</option>)}
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-3" controlId="loc-address"><Form.Label>Address</Form.Label><Form.Control value={value("address")} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={300} /></Form.Group>
      <Form.Group className="mb-3" controlId="loc-aliases"><Form.Label>Other names (comma separated)</Form.Label><Form.Control value={form.aliases ?? (location?.aliases || []).join(", ")} onChange={(event) => setForm({ ...form, aliases: event.target.value })} /></Form.Group>
      <Form.Group className="mb-3" controlId="loc-sort"><Form.Label>Sort order</Form.Label><Form.Control type="number" min={0} value={value("sortOrder", 0)} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /></Form.Group>
      {location ? <Form.Group controlId="loc-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

const LocationsPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const [filters, setFilters] = useState({ zoneId: "", search: "", page: 1 });
  const zones = useResource(() => fetchZones(), []);
  const { data, loading, error, reload } = useResource(() => fetchLocations({ ...filters, limit: 50 }), [JSON.stringify(filters)]);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);

  const toggle = async (location) => {
    setActionError(null);
    try {
      await updateLocation(location.id, { active: !location.active, reason: location.active ? "Deactivated from the locations list" : "Reactivated from the locations list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Locations" subtitle="Pickup and drop-off places customers can choose, each in a zone." actions={manage ? <Button size="sm" onClick={() => setEditing("new")} disabled={!zones.data?.length}>New location</Button> : null} />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2">
            <Col sm={6}><Form.Control type="search" placeholder="Search name, address or other names" aria-label="Search locations" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 1 })} /></Col>
            <Col sm={6}>
              <Form.Select aria-label="Zone" value={filters.zoneId} onChange={(event) => setFilters({ ...filters, zoneId: event.target.value, page: 1 })}>
                <option value="">All zones</option>
                {(zones.data || []).map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>
      <ErrorMessage error={error || actionError || zones.error} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.items.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Name</th><th>Type</th><th>Zone</th><th>Address</th><th>Status</th>{manage ? <th aria-label="Actions" /> : null}</tr></thead>
              <tbody>
                {data.items.map((location) => (
                  <tr key={location.id}>
                    <td><strong>{location.name}</strong>{location.aliases.length ? <div className="small text-muted">{location.aliases.join(", ")}</div> : null}</td>
                    <td>{LOCATION_TYPES.find(([type]) => type === location.type)?.[1]}</td>
                    <td>{location.zone?.code}{location.zone && !location.zone.active ? <Badge bg="secondary" className="ms-1">zone inactive</Badge> : null}</td>
                    <td className="small">{location.address}</td>
                    <td>{location.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    {manage ? (
                      <td className="text-end text-nowrap">
                        <Button size="sm" variant="outline-secondary" onClick={() => setEditing(location)}>Edit</Button>{" "}
                        <Button size="sm" variant={location.active ? "outline-danger" : "outline-success"} onClick={() => toggle(location)}>{location.active ? "Deactivate" : "Activate"}</Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Card.Footer><Pager pagination={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></Card.Footer>
          </Card>
        ) : (
          <Empty>No locations found.</Empty>
        )
      ) : null}
      <LocationModal key={editing?.id || editing || "none"} location={editing && editing !== "new" ? editing : null} zones={zones.data || []} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
    </>
  );
};

export default LocationsPage;

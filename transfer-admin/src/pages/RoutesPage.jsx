import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import { createRoute, fetchRoutes, fetchZones, updateRoute } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { P, can } from "../lib/permissions";

const RouteModal = ({ route, zones, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? route?.[field] ?? fallback;
  const number = (field) => (value(field, "") === "" || value(field, "") === null ? null : Number(value(field)));
  const submit = async () => {
    const common = { bidirectional: Boolean(value("bidirectional", true)), durationMinutes: number("durationMinutes"), distanceKm: number("distanceKm"), notes: value("notes") };
    // A route's zones cannot change once created: create a new route instead.
    if (route) await updateRoute(route.id, { ...common, reason: form.reason || undefined });
    else await createRoute({ ...common, fromZoneId: value("fromZoneId"), toZoneId: value("toZoneId") });
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={route ? `Edit route ${route.fromZone?.code} → ${route.toZone?.code}` : "New route"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      {!route ? (
        <Row className="g-3 mb-3">
          {["fromZoneId", "toZoneId"].map((field) => (
            <Col sm={6} key={field}>
              <Form.Group controlId={`route-${field}`}>
                <Form.Label>{field === "fromZoneId" ? "From zone" : "To zone"}</Form.Label>
                <Form.Select value={value(field)} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required>
                  <option value="">Select…</option>
                  {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
          ))}
        </Row>
      ) : null}
      <Form.Check className="mb-3" id="route-bidirectional" label="Same prices in both directions" checked={Boolean(value("bidirectional", true))} onChange={(event) => setForm({ ...form, bidirectional: event.target.checked })} />
      <Row className="g-3 mb-3">
        <Col sm={6}><Form.Group controlId="route-duration"><Form.Label>Duration (minutes)</Form.Label><Form.Control type="number" min={0} max={1440} value={value("durationMinutes") ?? ""} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></Form.Group></Col>
        <Col sm={6}><Form.Group controlId="route-distance"><Form.Label>Distance (km)</Form.Label><Form.Control type="number" min={0} step="0.1" value={value("distanceKm") ?? ""} onChange={(event) => setForm({ ...form, distanceKm: event.target.value })} /></Form.Group></Col>
      </Row>
      <Form.Group className="mb-3" controlId="route-notes"><Form.Label>Notes</Form.Label><Form.Control value={value("notes")} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={500} /></Form.Group>
      {route ? <Form.Group controlId="route-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

const RoutesPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const zones = useResource(() => fetchZones(), []);
  const { data, loading, error, reload } = useResource(() => fetchRoutes(), []);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);

  const toggle = async (route) => {
    setActionError(null);
    try {
      await updateRoute(route.id, { active: !route.active, reason: route.active ? "Deactivated from the routes list" : "Reactivated from the routes list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Routes" subtitle="Zone-to-zone routes. Prices are set per route on the Rates page." actions={manage ? <Button size="sm" onClick={() => setEditing("new")} disabled={!zones.data?.length}>New route</Button> : null} />
      <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Route</th><th>Directions</th><th>Duration</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.map((route) => (
                  <tr key={route.id}>
                    <td><strong>{route.fromZone?.code} → {route.toZone?.code}</strong><div className="small text-muted">{route.fromZone?.name} → {route.toZone?.name}</div></td>
                    <td>{route.bidirectional ? "Both ways" : "One way only"}</td>
                    <td>{route.durationMinutes ? `${route.durationMinutes} min` : "—"}{route.distanceKm ? ` · ${route.distanceKm} km` : ""}</td>
                    <td>{route.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    <td className="text-end text-nowrap">
                      <Link className="btn btn-sm btn-outline-primary" to={`/pricing/rates?routeId=${route.id}`}>Rates</Link>{" "}
                      {manage ? (
                        <>
                          <Button size="sm" variant="outline-secondary" onClick={() => setEditing(route)}>Edit</Button>{" "}
                          <Button size="sm" variant={route.active ? "outline-danger" : "outline-success"} onClick={() => toggle(route)}>{route.active ? "Deactivate" : "Activate"}</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No routes yet.</Empty>
        )
      ) : null}
      <RouteModal key={editing?.id || editing || "none"} route={editing && editing !== "new" ? editing : null} zones={zones.data || []} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
    </>
  );
};

export default RoutesPage;

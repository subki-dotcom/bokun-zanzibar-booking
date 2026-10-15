import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { createPopularRoute, fetchLocations, fetchPopularRoutes, updatePopularRoute } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { P, can } from "../lib/permissions";

// Inclusions shown on the website card. Switch one on only when the service really includes it.
const INCLUSIONS = [
  ["PRIVATE_VEHICLE", "Private vehicle"],
  ["PROFESSIONAL_DRIVER", "Professional driver"],
  ["FUEL_INCLUDED", "Fuel included"],
  ["HOTEL_PICKUP", "Hotel pickup"],
  ["HOTEL_DROPOFF", "Hotel drop-off"],
  ["LUGGAGE_ASSISTANCE", "Luggage assistance"]
];

// A place picker that searches the locations list (there are hundreds, so it never loads them all).
const PlacePicker = ({ id, label, value, initial, onChange }) => {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState(initial ? [initial] : []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      fetchLocations({ search, limit: 30, active: "true" })
        .then((result) => active && setOptions(() => {
          const found = result.items;
          return initial && !found.some((item) => item.id === initial.id) ? [initial, ...found] : found;
        }))
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, initial]);
  return (
    <Form.Group className="mb-3">
      <Form.Label htmlFor={id}>{label}</Form.Label>
      <Form.Control size="sm" className="mb-1" placeholder="Search places" aria-label={`Search ${label.toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} />
      <Form.Select id={id} value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="">Select…</option>
        {options.map((location) => <option key={location.id} value={location.id}>{location.name}{location.zone?.code ? ` (${location.zone.code})` : ""}</option>)}
      </Form.Select>
    </Form.Group>
  );
};

const RouteModal = ({ route, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? route?.[field] ?? fallback;
  const inclusions = value("inclusions", ["PRIVATE_VEHICLE"]);
  const toggle = (item) => setForm({ ...form, inclusions: inclusions.includes(item) ? inclusions.filter((entry) => entry !== item) : [...inclusions, item] });
  const submit = async () => {
    const body = {
      slug: value("slug"),
      title: value("title"),
      pickupLocationId: value("pickupLocationId"),
      dropoffLocationId: value("dropoffLocationId"),
      inclusions,
      displayOrder: Number(value("displayOrder", 0)) || 0
    };
    if (route) await updatePopularRoute(route.id, { ...body, reason: form.reason || undefined });
    else await createPopularRoute(body);
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} size="lg" title={route ? `Edit ${route.title}` : "New popular route"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <p className="small text-muted">The price is never entered here: the website shows the lowest rate of the route between the two places&apos; zones, or &quot;Price on Request&quot; when the route has none.</p>
      <Row className="g-3">
        <Col sm={8}><Form.Group controlId="pr-title"><Form.Label>Title (shown to customers)</Form.Label><Form.Control value={value("title")} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={3} maxLength={120} required /></Form.Group></Col>
        <Col sm={4}><Form.Group controlId="pr-order"><Form.Label>Display order</Form.Label><Form.Control type="number" min={0} value={value("displayOrder", 0)} onChange={(event) => setForm({ ...form, displayOrder: event.target.value })} /></Form.Group></Col>
        <Col sm={12}><Form.Group controlId="pr-slug"><Form.Label>Link name</Form.Label><Form.Control value={value("slug")} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required /><Form.Text>Used in /transfers?route=… e.g. zanzibar-airport-to-nungwi</Form.Text></Form.Group></Col>
        <Col sm={6}><PlacePicker id="pr-pickup" label="Pickup" value={value("pickupLocationId")} initial={route?.pickup} onChange={(id) => setForm({ ...form, pickupLocationId: id })} /></Col>
        <Col sm={6}><PlacePicker id="pr-dropoff" label="Drop-off" value={value("dropoffLocationId")} initial={route?.dropoff} onChange={(id) => setForm({ ...form, dropoffLocationId: id })} /></Col>
      </Row>
      <fieldset className="mb-3">
        <legend className="form-label fs-6">Included (shown on the card)</legend>
        {INCLUSIONS.map(([item, label]) => (
          <Form.Check key={item} inline id={`pr-inc-${item}`} label={label} checked={inclusions.includes(item)} onChange={() => toggle(item)} />
        ))}
      </fieldset>
      {route ? <Form.Group controlId="pr-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

const PopularRoutesPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const { data, loading, error, reload } = useResource(() => fetchPopularRoutes(), []);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);
  const label = (item) => INCLUSIONS.find(([key]) => key === item)?.[1] || item;

  const toggle = async (route) => {
    setActionError(null);
    try {
      await updatePopularRoute(route.id, { active: !route.active, reason: route.active ? "Hidden from the website" : "Shown on the website" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Popular routes" subtitle="Bookable routes shown under the booking widget on the website. Prices come from Routes and Rates." actions={manage ? <Button size="sm" onClick={() => setEditing("new")}>New popular route</Button> : null} />
      <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Order</th><th>Title</th><th>Pickup → Drop-off</th><th>Included</th><th>Status</th>{manage ? <th aria-label="Actions" /> : null}</tr></thead>
              <tbody>
                {data.map((route) => (
                  <tr key={route.id}>
                    <td>{route.displayOrder}</td>
                    <td><strong>{route.title}</strong><div className="small text-muted">{route.slug}</div></td>
                    <td className="small">{route.pickup?.name || "missing place"} → {route.dropoff?.name || "missing place"}</td>
                    <td className="small">{route.inclusions.map(label).join(", ") || "—"}</td>
                    <td>{route.active ? <Badge bg="success">Shown</Badge> : <Badge bg="secondary">Hidden</Badge>}</td>
                    {manage ? (
                      <td className="text-end text-nowrap">
                        <Button size="sm" variant="outline-secondary" onClick={() => setEditing(route)}>Edit</Button>{" "}
                        <Button size="sm" variant={route.active ? "outline-danger" : "outline-success"} onClick={() => toggle(route)}>{route.active ? "Hide" : "Show"}</Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No popular routes yet.</Empty>
        )
      ) : null}
      <RouteModal key={editing?.id || editing || "none"} route={editing && editing !== "new" ? editing : null} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
    </>
  );
};

export default PopularRoutesPage;

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { createRate, fetchLocations, fetchRates, fetchRoutes, previewPrice, updateRate } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { usd } from "../lib/format";
import { P, can } from "../lib/permissions";

const RateModal = ({ rate, routeId, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? rate?.[field] ?? fallback;
  const submit = async () => {
    const body = { minPassengers: Number(value("minPassengers", 1)), maxPassengers: Number(value("maxPassengers", 5)), price: String(value("price")).trim() };
    if (rate) await updateRate(rate.id, { ...body, reason: form.reason || undefined });
    else await createRate({ ...body, routeId });
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={rate ? "Edit passenger tier" : "New passenger tier"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Row className="g-3 mb-3">
        <Col xs={6}><Form.Group controlId="rate-min"><Form.Label>From passengers</Form.Label><Form.Control type="number" min={1} max={99} value={value("minPassengers", 1)} onChange={(event) => setForm({ ...form, minPassengers: event.target.value })} required /></Form.Group></Col>
        <Col xs={6}><Form.Group controlId="rate-max"><Form.Label>To passengers</Form.Label><Form.Control type="number" min={1} max={99} value={value("maxPassengers", 5)} onChange={(event) => setForm({ ...form, maxPassengers: event.target.value })} required /></Form.Group></Col>
      </Row>
      <Form.Group className="mb-3" controlId="rate-price">
        <Form.Label>Price per vehicle (USD)</Form.Label>
        <Form.Control inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={value("price")} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
        <Form.Text>Tiers on one route may not overlap. Adults and children count; infants count only if the booking settings say so.</Form.Text>
      </Form.Group>
      {rate ? <Form.Group controlId="rate-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

// Runs the same server-side calculation the website uses.
const PriceCheck = () => {
  const { data } = useResource(() => fetchLocations({ active: true, limit: 100 }), []);
  const [form, setForm] = useState({ tripType: "ONE_WAY", pickupLocationId: "", dropoffLocationId: "", adults: 1, children: 0, infants: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const check = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      setResult(await previewPrice({ tripType: form.tripType, pickupLocationId: form.pickupLocationId, dropoffLocationId: form.dropoffLocationId, passengers: { adults: Number(form.adults), children: Number(form.children), infants: Number(form.infants) } }));
    } catch (failure) {
      setResult(null);
      setError(failure);
    }
  };
  const locations = data?.items || [];
  return (
    <Card className="ta-card mt-3">
      <Card.Body>
        <h2 className="h6">Price check</h2>
        <Form onSubmit={check}>
          <Row className="g-2 align-items-end">
            <Col sm={6} lg={3}><Form.Group controlId="pc-pickup"><Form.Label>Pickup</Form.Label><Form.Select value={form.pickupLocationId} onChange={(event) => setForm({ ...form, pickupLocationId: event.target.value })} required><option value="">Select…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} ({location.zone?.code})</option>)}</Form.Select></Form.Group></Col>
            <Col sm={6} lg={3}><Form.Group controlId="pc-dropoff"><Form.Label>Drop-off</Form.Label><Form.Select value={form.dropoffLocationId} onChange={(event) => setForm({ ...form, dropoffLocationId: event.target.value })} required><option value="">Select…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} ({location.zone?.code})</option>)}</Form.Select></Form.Group></Col>
            <Col xs={6} lg={2}><Form.Group controlId="pc-trip"><Form.Label>Trip</Form.Label><Form.Select value={form.tripType} onChange={(event) => setForm({ ...form, tripType: event.target.value })}><option value="ONE_WAY">One way</option><option value="ROUND_TRIP">Round trip</option></Form.Select></Form.Group></Col>
            <Col xs={2} lg={1}><Form.Group controlId="pc-adults"><Form.Label>Ad</Form.Label><Form.Control type="number" min={1} value={form.adults} onChange={(event) => setForm({ ...form, adults: event.target.value })} /></Form.Group></Col>
            <Col xs={2} lg={1}><Form.Group controlId="pc-children"><Form.Label>Ch</Form.Label><Form.Control type="number" min={0} value={form.children} onChange={(event) => setForm({ ...form, children: event.target.value })} /></Form.Group></Col>
            <Col xs={2} lg={1}><Form.Group controlId="pc-infants"><Form.Label>Inf</Form.Label><Form.Control type="number" min={0} value={form.infants} onChange={(event) => setForm({ ...form, infants: event.target.value })} /></Form.Group></Col>
            <Col xs={12} lg={1}><Button type="submit" className="w-100">Check</Button></Col>
          </Row>
        </Form>
        <ErrorMessage error={error} />
        {result ? (
          result.status === "PRICED" ? (
            <Alert variant="success" className="mt-3 mb-0">{usd(result.total)} per vehicle · {result.legs.map((leg) => `${leg.direction.toLowerCase()} ${usd(leg.price)} (tier ${leg.tier.minPassengers}–${leg.tier.maxPassengers})`).join(" + ")} · {result.passengers.priced} priced, {result.passengers.capacity} seats</Alert>
          ) : (
            <Alert variant="warning" className="mt-3 mb-0">Request a Quote: {result.reasons.join(", ")} · {result.passengers.priced} priced, {result.passengers.capacity} seats</Alert>
          )
        ) : null}
      </Card.Body>
    </Card>
  );
};

const RatesPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const [params, setParams] = useSearchParams();
  const routeId = params.get("routeId") || "";
  const routes = useResource(() => fetchRoutes(), []);
  const { data, loading, error, reload } = useResource(() => (routeId ? fetchRates({ routeId }) : Promise.resolve([])), [routeId]);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);
  const route = (routes.data || []).find((item) => item.id === routeId);

  const toggle = async (rate) => {
    setActionError(null);
    try {
      await updateRate(rate.id, { active: !rate.active, reason: rate.active ? "Deactivated from the rates list" : "Reactivated from the rates list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Rates" subtitle="Passenger tiers and prices per vehicle (USD) for each route." actions={manage && routeId ? <Button size="sm" onClick={() => setEditing("new")}>New tier</Button> : null} />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Form.Group controlId="rates-route">
            <Form.Label>Route</Form.Label>
            <Form.Select value={routeId} onChange={(event) => setParams(event.target.value ? { routeId: event.target.value } : {})}>
              <option value="">Select a route…</option>
              {(routes.data || []).map((item) => <option key={item.id} value={item.id}>{item.fromZone?.code} → {item.toZone?.code} ({item.bidirectional ? "both ways" : "one way"}){item.active ? "" : " · inactive"}</option>)}
            </Form.Select>
          </Form.Group>
        </Card.Body>
      </Card>
      <ErrorMessage error={error || actionError || routes.error} onRetry={error ? reload : undefined} />
      {routeId && loading && !data ? <Loading /> : null}
      {routeId && data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Passengers</th><th className="text-end">Price per vehicle</th><th>Status</th>{manage ? <th aria-label="Actions" /> : null}</tr></thead>
              <tbody>
                {data.map((rate) => (
                  <tr key={rate.id}>
                    <td>{rate.minPassengers}–{rate.maxPassengers}</td>
                    <td className="text-end"><strong>{usd(rate.price)}</strong></td>
                    <td>{rate.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    {manage ? (
                      <td className="text-end text-nowrap">
                        <Button size="sm" variant="outline-secondary" onClick={() => setEditing(rate)}>Edit</Button>{" "}
                        <Button size="sm" variant={rate.active ? "outline-danger" : "outline-success"} onClick={() => toggle(rate)}>{rate.active ? "Deactivate" : "Activate"}</Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No tiers for {route ? `${route.fromZone?.code} → ${route.toZone?.code}` : "this route"}. Customers will see Request a Quote.</Empty>
        )
      ) : null}
      {!routeId ? <Empty>Select a route to see its passenger tiers.</Empty> : null}
      <PriceCheck />
      <RateModal key={editing?.id || editing || "none"} rate={editing && editing !== "new" ? editing : null} routeId={routeId} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
    </>
  );
};

export default RatesPage;

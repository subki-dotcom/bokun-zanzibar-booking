import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { createVehicle, fetchVehicleHistory, fetchVehicles, updateVehicle } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { VEHICLE_STATUS, VEHICLE_TYPES, labelOf } from "../lib/format";
import { P, can } from "../lib/permissions";
import FleetHistoryModal from "./FleetHistoryModal";

const VehicleModal = ({ vehicle, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? vehicle?.[field] ?? fallback;
  const partner = value("ownership", "COMPANY") === "PARTNER";
  const submit = async () => {
    const luggage = value("luggageCapacity", "");
    const body = {
      registrationNumber: value("registrationNumber"),
      makeModel: value("makeModel"),
      vehicleType: value("vehicleType", "VAN"),
      passengerCapacity: Number(value("passengerCapacity", 4)),
      luggageCapacity: luggage === "" || luggage === null ? null : Number(luggage),
      ownership: value("ownership", "COMPANY"),
      partnerName: partner ? value("partnerName") : "",
      operationalStatus: value("operationalStatus", "AVAILABLE"),
      notes: value("notes")
    };
    if (vehicle) await updateVehicle(vehicle.id, { ...body, reason: form.reason || undefined });
    else await createVehicle(body);
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={vehicle ? `Edit ${vehicle.registrationNumber}` : "New vehicle"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Row className="g-3 mb-3">
        <Col sm={6}><Form.Group controlId="vehicle-registration"><Form.Label>Registration number</Form.Label><Form.Control value={value("registrationNumber")} onChange={(event) => setForm({ ...form, registrationNumber: event.target.value })} maxLength={20} required /></Form.Group></Col>
        <Col sm={6}><Form.Group controlId="vehicle-model"><Form.Label>Make and model</Form.Label><Form.Control value={value("makeModel")} onChange={(event) => setForm({ ...form, makeModel: event.target.value })} maxLength={80} /></Form.Group></Col>
      </Row>
      <Row className="g-3 mb-3">
        <Col sm={4}><Form.Group controlId="vehicle-type"><Form.Label>Type</Form.Label><Form.Select value={value("vehicleType", "VAN")} onChange={(event) => setForm({ ...form, vehicleType: event.target.value })}>{VEHICLE_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Form.Select></Form.Group></Col>
        <Col sm={4}><Form.Group controlId="vehicle-seats"><Form.Label>Passenger seats</Form.Label><Form.Control type="number" min={1} max={99} value={value("passengerCapacity", 4)} onChange={(event) => setForm({ ...form, passengerCapacity: event.target.value })} required /><Form.Text>Not counting the driver. Infants need a seat.</Form.Text></Form.Group></Col>
        <Col sm={4}><Form.Group controlId="vehicle-luggage"><Form.Label>Luggage (bags)</Form.Label><Form.Control type="number" min={0} max={200} value={value("luggageCapacity", "") ?? ""} onChange={(event) => setForm({ ...form, luggageCapacity: event.target.value })} /></Form.Group></Col>
      </Row>
      <Row className="g-3 mb-3">
        <Col sm={6}><Form.Group controlId="vehicle-ownership"><Form.Label>Ownership</Form.Label><Form.Select value={value("ownership", "COMPANY")} onChange={(event) => setForm({ ...form, ownership: event.target.value })}><option value="COMPANY">Company-owned</option><option value="PARTNER">Partner vehicle</option></Form.Select></Form.Group></Col>
        {partner ? <Col sm={6}><Form.Group controlId="vehicle-partner"><Form.Label>Partner name</Form.Label><Form.Control value={value("partnerName")} onChange={(event) => setForm({ ...form, partnerName: event.target.value })} maxLength={120} required /></Form.Group></Col> : null}
      </Row>
      <Form.Group className="mb-3" controlId="vehicle-status"><Form.Label>Operational status</Form.Label><Form.Select value={value("operationalStatus", "AVAILABLE")} onChange={(event) => setForm({ ...form, operationalStatus: event.target.value })}>{VEHICLE_STATUS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Form.Select></Form.Group>
      <Form.Group className="mb-3" controlId="vehicle-notes"><Form.Label>Notes</Form.Label><Form.Control as="textarea" rows={2} value={value("notes")} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={500} /></Form.Group>
      {vehicle ? <Form.Group controlId="vehicle-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

const VehiclesPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.FLEET_MANAGE);
  const [filters, setFilters] = useState({ search: "", operationalStatus: "" });
  const { data, loading, error, reload } = useResource(() => fetchVehicles(filters), [JSON.stringify(filters)]);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [actionError, setActionError] = useState(null);

  const toggle = async (vehicle) => {
    setActionError(null);
    try {
      await updateVehicle(vehicle.id, { active: !vehicle.active, reason: vehicle.active ? "Deactivated from the vehicles list" : "Reactivated from the vehicles list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Vehicles" subtitle="Only active vehicles in service with enough seats can be assigned." actions={manage ? <Button size="sm" onClick={() => setEditing("new")}>New vehicle</Button> : null} />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2">
            <Col sm={8}><Form.Control type="search" placeholder="Search registration, model or partner" aria-label="Search vehicles" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></Col>
            <Col sm={4}>
              <Form.Select aria-label="Operational status" value={filters.operationalStatus} onChange={(event) => setFilters({ ...filters, operationalStatus: event.target.value })}>
                <option value="">Any status</option>
                {VEHICLE_STATUS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>
      <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Vehicle</th><th>Seats</th><th>Ownership</th><th>Operational status</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td><strong>{vehicle.registrationNumber}</strong><div className="small text-muted">{labelOf(VEHICLE_TYPES, vehicle.vehicleType)}{vehicle.makeModel ? ` · ${vehicle.makeModel}` : ""}</div></td>
                    <td>{vehicle.passengerCapacity}{vehicle.luggageCapacity !== null ? <div className="small text-muted">{vehicle.luggageCapacity} bags</div> : null}</td>
                    <td>{vehicle.ownership === "PARTNER" ? `Partner · ${vehicle.partnerName}` : "Company"}</td>
                    <td>{labelOf(VEHICLE_STATUS, vehicle.operationalStatus)}</td>
                    <td>{vehicle.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    <td className="text-end text-nowrap">
                      <Button size="sm" variant="outline-primary" onClick={() => setHistory(vehicle)}>Trips</Button>{" "}
                      {manage ? (
                        <>
                          <Button size="sm" variant="outline-secondary" onClick={() => setEditing(vehicle)}>Edit</Button>{" "}
                          <Button size="sm" variant={vehicle.active ? "outline-danger" : "outline-success"} onClick={() => toggle(vehicle)}>{vehicle.active ? "Deactivate" : "Activate"}</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No vehicles found.</Empty>
        )
      ) : null}
      <VehicleModal key={editing?.id || editing || "none"} vehicle={editing && editing !== "new" ? editing : null} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
      <FleetHistoryModal title={`Trips for ${history?.registrationNumber || ""}`} show={Boolean(history)} onHide={() => setHistory(null)} load={() => fetchVehicleHistory(history.id)} />
    </>
  );
};

export default VehiclesPage;

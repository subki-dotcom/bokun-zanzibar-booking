import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { createDriver, fetchDriverHistory, fetchDrivers, updateDriver } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { DRIVER_AVAILABILITY, labelOf, zanzibarToday } from "../lib/format";
import { P, can } from "../lib/permissions";
import FleetHistoryModal from "./FleetHistoryModal";

const DriverModal = ({ driver, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? driver?.[field] ?? fallback;
  const submit = async () => {
    const body = {
      fullName: value("fullName"),
      phone: value("phone"),
      whatsapp: Boolean(value("whatsapp", true)),
      licenseNumber: value("licenseNumber"),
      licenseClass: value("licenseClass"),
      licenseExpiresOn: value("licenseExpiresOn"),
      availability: value("availability", "AVAILABLE"),
      notes: value("notes")
    };
    if (driver) await updateDriver(driver.id, { ...body, reason: form.reason || undefined });
    else await createDriver(body);
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={driver ? `Edit ${driver.fullName}` : "New driver"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Form.Group className="mb-3" controlId="driver-name"><Form.Label>Full name</Form.Label><Form.Control value={value("fullName")} onChange={(event) => setForm({ ...form, fullName: event.target.value })} minLength={2} maxLength={120} required /></Form.Group>
      <Row className="g-3 mb-3">
        <Col sm={7}><Form.Group controlId="driver-phone"><Form.Label>Phone</Form.Label><Form.Control type="tel" value={value("phone")} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+255 …" required /></Form.Group></Col>
        <Col sm={5} className="d-flex align-items-end"><Form.Check id="driver-whatsapp" label="On WhatsApp" checked={Boolean(value("whatsapp", true))} onChange={(event) => setForm({ ...form, whatsapp: event.target.checked })} /></Col>
      </Row>
      <Row className="g-3 mb-3">
        <Col sm={5}><Form.Group controlId="driver-license"><Form.Label>Licence number</Form.Label><Form.Control value={value("licenseNumber")} onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })} minLength={3} maxLength={40} required /></Form.Group></Col>
        <Col sm={3}><Form.Group controlId="driver-license-class"><Form.Label>Class</Form.Label><Form.Control value={value("licenseClass")} onChange={(event) => setForm({ ...form, licenseClass: event.target.value })} maxLength={40} /></Form.Group></Col>
        <Col sm={4}><Form.Group controlId="driver-license-expiry"><Form.Label>Expires on</Form.Label><Form.Control type="date" value={value("licenseExpiresOn")} onChange={(event) => setForm({ ...form, licenseExpiresOn: event.target.value })} /></Form.Group></Col>
      </Row>
      <Form.Group className="mb-3" controlId="driver-availability"><Form.Label>Availability</Form.Label>
        <Form.Select value={value("availability", "AVAILABLE")} onChange={(event) => setForm({ ...form, availability: event.target.value })}>{DRIVER_AVAILABILITY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Form.Select>
      </Form.Group>
      <Form.Group className="mb-3" controlId="driver-notes"><Form.Label>Notes</Form.Label><Form.Control as="textarea" rows={2} value={value("notes")} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={500} /></Form.Group>
      {driver ? <Form.Group controlId="driver-reason"><Form.Label>Reason for the change (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group> : null}
    </FormModal>
  );
};

const DriversPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.FLEET_MANAGE);
  const [filters, setFilters] = useState({ search: "", availability: "" });
  const { data, loading, error, reload } = useResource(() => fetchDrivers(filters), [JSON.stringify(filters)]);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [actionError, setActionError] = useState(null);
  const today = zanzibarToday();

  const toggle = async (driver) => {
    setActionError(null);
    try {
      await updateDriver(driver.id, { active: !driver.active, reason: driver.active ? "Deactivated from the drivers list" : "Reactivated from the drivers list" });
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Drivers" subtitle="Only active, available drivers with a valid licence can be assigned." actions={manage ? <Button size="sm" onClick={() => setEditing("new")}>New driver</Button> : null} />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2">
            <Col sm={8}><Form.Control type="search" placeholder="Search name, phone or licence" aria-label="Search drivers" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></Col>
            <Col sm={4}>
              <Form.Select aria-label="Availability" value={filters.availability} onChange={(event) => setFilters({ ...filters, availability: event.target.value })}>
                <option value="">Any availability</option>
                {DRIVER_AVAILABILITY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
              <thead><tr><th>Driver</th><th>Licence</th><th>Availability</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.map((driver) => (
                  <tr key={driver.id}>
                    <td><strong>{driver.fullName}</strong><div className="small text-muted">{driver.phone}{driver.whatsapp ? " · WhatsApp" : ""}</div></td>
                    <td>{driver.licenseNumber}{driver.licenseClass ? ` · ${driver.licenseClass}` : ""}{driver.licenseExpiresOn ? <div className={`small ${driver.licenseExpiresOn < today ? "text-danger" : "text-muted"}`}>{driver.licenseExpiresOn < today ? "Expired" : "Expires"} {driver.licenseExpiresOn}</div> : null}</td>
                    <td>{labelOf(DRIVER_AVAILABILITY, driver.availability)}</td>
                    <td>{driver.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}</td>
                    <td className="text-end text-nowrap">
                      <Button size="sm" variant="outline-primary" onClick={() => setHistory(driver)}>Trips</Button>{" "}
                      {manage ? (
                        <>
                          <Button size="sm" variant="outline-secondary" onClick={() => setEditing(driver)}>Edit</Button>{" "}
                          <Button size="sm" variant={driver.active ? "outline-danger" : "outline-success"} onClick={() => toggle(driver)}>{driver.active ? "Deactivate" : "Activate"}</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No drivers found.</Empty>
        )
      ) : null}
      <DriverModal key={editing?.id || editing || "none"} driver={editing && editing !== "new" ? editing : null} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
      <FleetHistoryModal title={`Trips for ${history?.fullName || ""}`} show={Boolean(history)} onHide={() => setHistory(null)} load={() => fetchDriverHistory(history.id)} />
    </>
  );
};

export default DriversPage;

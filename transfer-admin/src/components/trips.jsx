import { useEffect, useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { assignTrip, changeTripStatus, fetchDrivers, fetchVehicles, unassignTrip } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { P, can } from "../lib/permissions";
import { TRIP_ACTION, tripStatusMeta } from "../lib/format";
import { ErrorMessage, FormModal, ReasonModal } from "./ui";

export const TripStatusBadge = ({ status }) => {
  const meta = tripStatusMeta(status);
  return <Badge bg={meta.bg} text={meta.text}>{meta.label}</Badge>;
};

// Lists only drivers and vehicles that can take this trip; the server checks again, including overlaps.
const AssignModal = ({ trip, show, onHide, onDone }) => {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ driverId: "", vehicleId: "", reason: "" });
  const [loadError, setLoadError] = useState(null);
  const reassignment = Boolean(trip.driver || trip.vehicle);

  useEffect(() => {
    if (!show) return;
    setForm({ driverId: trip.driver?.id || "", vehicleId: trip.vehicle?.id || "", reason: "" });
    setLoadError(null);
    Promise.all([fetchDrivers({ active: "true", availability: "AVAILABLE" }), fetchVehicles({ active: "true", operationalStatus: "AVAILABLE", minSeats: trip.seatsNeeded })])
      .then(([driverList, vehicleList]) => {
        setDrivers(driverList);
        setVehicles(vehicleList);
      })
      .catch(setLoadError);
  }, [show, trip]);

  return (
    <FormModal
      show={show}
      title={`${reassignment ? "Change" : "Assign"} driver and vehicle · ${trip.bookingReference} ${trip.direction === "RETURN" ? "return" : "outbound"}`}
      onHide={onHide}
      submitLabel={reassignment ? "Reassign" : "Assign"}
      onSubmit={async () => {
        await assignTrip(trip.id, { driverId: form.driverId, vehicleId: form.vehicleId, expectedVersion: trip.version, ...(reassignment ? { reason: form.reason } : {}) });
        await onDone();
      }}
    >
      <p className="small text-muted">{trip.localDate} {trip.localTime} EAT · {trip.pickupLocationName} → {trip.dropoffLocationName} · needs {trip.seatsNeeded} seat{trip.seatsNeeded === 1 ? "" : "s"} (infants included)</p>
      <ErrorMessage error={loadError} />
      <Form.Group className="mb-3" controlId={`assign-driver-${trip.id}`}>
        <Form.Label>Driver</Form.Label>
        <Form.Select value={form.driverId} onChange={(event) => setForm({ ...form, driverId: event.target.value })} required>
          <option value="">Select an available driver…</option>
          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName} · {driver.phone}</option>)}
        </Form.Select>
      </Form.Group>
      <Form.Group className="mb-3" controlId={`assign-vehicle-${trip.id}`}>
        <Form.Label>Vehicle</Form.Label>
        <Form.Select value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })} required>
          <option value="">Select a vehicle with enough seats…</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registrationNumber} · {vehicle.passengerCapacity} seats{vehicle.ownership === "PARTNER" ? ` · ${vehicle.partnerName}` : ""}</option>)}
        </Form.Select>
        {!vehicles.length && !loadError ? <Form.Text className="text-danger">No available vehicle has {trip.seatsNeeded} seats.</Form.Text> : null}
      </Form.Group>
      {reassignment ? (
        <Form.Group controlId={`assign-reason-${trip.id}`}>
          <Form.Label>Reason for the change (saved in the audit log)</Form.Label>
          <Form.Control as="textarea" rows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} minLength={3} maxLength={500} required />
        </Form.Group>
      ) : null}
    </FormModal>
  );
};

// Assign, reassign, unassign and status buttons for one trip. Every request names the trip version it saw, so a
// double click or a stale screen cannot apply an action twice.
export const TripActions = ({ trip, onChanged }) => {
  const { user } = useAuth();
  const [modal, setModal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!can(user, P.DISPATCH_MANAGE)) return null;
  if (!trip.dispatchable) return <span className="small text-muted">Not dispatchable: {trip.blockers.join(", ")}</span>;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (failure) {
      setError(failure);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  const assigned = Boolean(trip.driver && trip.vehicle);
  const canAssign = ["SCHEDULED", "DRIVER_EN_ROUTE"].includes(trip.status);

  return (
    <div className="ta-trip-actions">
      {canAssign ? <Button size="sm" variant={assigned ? "outline-secondary" : "primary"} disabled={busy} onClick={() => setModal("assign")}>{assigned ? "Change" : "Assign"}</Button> : null}
      {trip.status === "SCHEDULED" && (trip.driver || trip.vehicle) ? <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setModal("unassign")}>Unassign</Button> : null}
      {assigned
        ? trip.nextStatuses.map((next) => (
            <Button key={next} size="sm" variant={next === "NO_SHOW" ? "outline-danger" : "outline-primary"} disabled={busy}
              onClick={() => (next === "NO_SHOW" ? setModal("noshow") : run(() => changeTripStatus(trip.id, { status: next, expectedVersion: trip.version })))}>
              {TRIP_ACTION[next]}
            </Button>
          ))
        : null}
      {error ? <div className="w-100"><ErrorMessage error={error} /></div> : null}
      <AssignModal trip={trip} show={modal === "assign"} onHide={() => setModal("")} onDone={onChanged} />
      <ReasonModal show={modal === "unassign"} title="Unassign driver and vehicle" submitLabel="Unassign" variant="warning" onHide={() => setModal("")}
        onSubmit={async (reason) => {
          await unassignTrip(trip.id, { reason, expectedVersion: trip.version });
          await onChanged();
        }} />
      <ReasonModal show={modal === "noshow"} title="Mark as no-show" description="Describe what happened (how long the driver waited, calls made)." submitLabel="Mark no-show" variant="danger" onHide={() => setModal("")}
        onSubmit={async (note) => {
          await changeTripStatus(trip.id, { status: "NO_SHOW", expectedVersion: trip.version, note });
          await onChanged();
        }} />
    </div>
  );
};

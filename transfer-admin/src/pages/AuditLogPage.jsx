import { useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { fetchAuditLogs } from "../api/transferAdminApi";
import { Empty, ErrorMessage, Loading, PageHeader, Pager, useResource } from "../components/ui";
import { dateTime } from "../lib/format";

const ENTITY_TYPES = ["TransferBooking", "TransferZone", "TransferLocation", "TransferRoute", "TransferRate", "TransferSettings", "TransferAdminUser"];

const Changes = ({ entry }) => {
  const [open, setOpen] = useState(false);
  if (!entry.before && !entry.after) return null;
  return (
    <>
      <Button size="sm" variant="link" className="p-0" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide changes" : "Show changes"}</Button>
      {open ? (
        <div className="ta-audit-diff">
          {entry.before ? <div><strong>Before</strong><pre>{JSON.stringify(entry.before, null, 2)}</pre></div> : null}
          {entry.after ? <div><strong>After</strong><pre>{JSON.stringify(entry.after, null, 2)}</pre></div> : null}
        </div>
      ) : null}
    </>
  );
};

// Read-only view of the immutable Transfer audit log.
const AuditLogPage = () => {
  const [filters, setFilters] = useState({ action: "", entityType: "", from: "", to: "", page: 1 });
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  if (query.from) query.from = `${filters.from}T00:00:00+03:00`;
  if (query.to) query.to = `${filters.to}T23:59:59+03:00`;
  const { data, loading, error, reload } = useResource(() => fetchAuditLogs({ ...query, limit: 50 }), [JSON.stringify(filters)]);
  const set = (field) => (event) => setFilters({ ...filters, [field]: event.target.value.trim(), page: 1 });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change in the Transfer System, newest first. Entries cannot be edited or deleted." />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2">
            <Col sm={6} lg={3}><Form.Control placeholder="Action, e.g. booking.quoted" aria-label="Action" defaultValue={filters.action} onBlur={set("action")} onKeyDown={(event) => event.key === "Enter" && set("action")(event)} /></Col>
            <Col sm={6} lg={3}>
              <Form.Select aria-label="Record type" value={filters.entityType} onChange={set("entityType")}>
                <option value="">All record types</option>
                {ENTITY_TYPES.map((type) => <option key={type} value={type}>{type.replace("Transfer", "")}</option>)}
              </Form.Select>
            </Col>
            <Col xs={6} lg={3}><Form.Control type="date" aria-label="From" value={filters.from} onChange={set("from")} /></Col>
            <Col xs={6} lg={3}><Form.Control type="date" aria-label="To" value={filters.to} onChange={set("to")} /></Col>
          </Row>
        </Card.Body>
      </Card>
      <ErrorMessage error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.items.length ? (
          <Card className="ta-card">
            <Table responsive className="mb-0 align-top ta-table">
              <thead><tr><th>When (EAT)</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-nowrap small">{dateTime(entry.createdAt)}</td>
                    <td className="small">{entry.actorEmail || "—"}<div className="text-muted">{entry.actorRole}</div></td>
                    <td><code>{entry.action}</code></td>
                    <td className="small">{entry.entityType.replace("Transfer", "")}<div className="text-muted">{entry.entityId}</div></td>
                    <td className="small">{entry.reason ? <div>{entry.reason}</div> : null}{entry.ipAddress ? <div className="text-muted">{entry.ipAddress}</div> : null}<Changes entry={entry} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Card.Footer><Pager pagination={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></Card.Footer>
          </Card>
        ) : (
          <Empty>No audit entries match these filters.</Empty>
        )
      ) : null}
    </>
  );
};

export default AuditLogPage;

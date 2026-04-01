import { useEffect, useState } from "react";
import { Card, Table } from "react-bootstrap";
import { fetchDashboardSummary } from "../../api/adminApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatDate } from "../../utils/formatters";

const SyncLogsPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchDashboardSummary();
        setLogs(result.syncLogs || []);
      } catch (err) {
        setError(err.message || "Failed to fetch sync logs");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <>
      <h2 className="mb-1">Sync Logs</h2>
      <p className="section-subtitle mb-4">Track product sync runs and webhook/polling readiness events.</p>
      <ErrorAlert error={error} />
      {loading ? <Loader message="Loading sync logs..." /> : null}

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <Table responsive hover>
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Status</th>
                  <th>Synced Count</th>
                  <th>Started</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td>{log.operation}</td>
                    <td>{log.status}</td>
                    <td>{log.syncedCount}</td>
                    <td>{formatDate(log.startedAt, "YYYY-MM-DD HH:mm")}</td>
                    <td>{formatDate(log.completedAt, "YYYY-MM-DD HH:mm")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default SyncLogsPage;
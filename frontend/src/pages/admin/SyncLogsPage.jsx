import { useEffect, useState } from "react";
import { AdminPage, DataTable, EmptyState, PageHeader, SectionCard, StatusBadge, RelativeTime } from "../../components/admin/ui";
import { formatAdminDateTime } from "../../utils/adminFormat";
import { formatLabel } from "../../utils/formatLabel";
import { fetchDashboardSummary } from "../../api/adminApi";

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

  const columns = [
    { key: "operation", header: "Operation", render: (log) => <span title={log.operation}>{formatLabel(log.operation)}</span> },
    { key: "status", header: "Status", render: (log) => <StatusBadge value={log.status === "started" ? "in_progress" : log.status} label={log.status === "started" ? "Running" : formatLabel(log.status)} /> },
    { key: "syncedCount", header: "Synced", align: "end", render: (log) => log.syncedCount ?? 0 },
    { key: "startedAt", header: "Started", render: (log) => <RelativeTime value={log.startedAt} /> },
    { key: "completedAt", header: "Completed", render: (log) => (log.completedAt ? formatAdminDateTime(log.completedAt) : "—") }
  ];

  return (
    <AdminPage>
      <PageHeader eyebrow="Integrations" title="Sync Logs" description="Every Bókun import, product sync and webhook run, newest first. Kept for 7 days." />
      <SectionCard>
        <DataTable
          columns={columns}
          rows={logs}
          rowKey={(log) => log._id}
          loading={loading}
          error={error}
          pageSize={50}
          caption="Sync logs"
          empty={<EmptyState title="No sync runs yet" message="Runs appear here as soon as the scheduled Bókun import or a manual sync runs." />}
        />
      </SectionCard>
    </AdminPage>
  );
};

export default SyncLogsPage;
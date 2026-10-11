import { Card } from "react-bootstrap";
import { BsLock } from "react-icons/bs";
import PageHeader from "./PageHeader";

const AdminUnavailablePage = ({ title = "Not available yet", module = "Admin module" }) => (
  <section className="admin-platform-unavailable">
    <PageHeader
      eyebrow={module}
      title={title}
      description="Not available yet. This area will be enabled when the supporting backend accounting and reporting services are implemented."
    />
    <Card className="admin-platform-card">
      <Card.Body>
        <div className="admin-platform-empty-state">
          <span className="admin-platform-empty-icon"><BsLock aria-hidden="true" /></span>
          <strong>Not available yet</strong>
          <p>No fake financial totals or placeholder business records are shown here.</p>
        </div>
      </Card.Body>
    </Card>
  </section>
);

export default AdminUnavailablePage;

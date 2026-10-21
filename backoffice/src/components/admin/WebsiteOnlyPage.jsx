import { Button, Card } from "react-bootstrap";
import { BsBoxArrowUpRight } from "react-icons/bs";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "./PageHeader";
import { WEBSITE_ADMIN_URL } from "../../config/site";

// Shown in the Back Office for the tour booking and operations pages that live only in the Website Tour Admin
// (Tour Dashboard, Tour Bookings, Customer Requests, Booking Requests, Tour Operations, Assignments and Recovery
// Center). The pages are not mounted in the Back Office at all.
const WebsiteOnlyPage = () => {
  const { pathname, search } = useLocation();
  return (
    <div className="website-only-page">
      <PageHeader
        eyebrow="Website Tour Admin"
        title="This page is in the Website Tour Admin"
        description="Tour bookings, customer and booking requests, tour operations, assignments and recovery are managed in the Website Tour Admin. The Back Office keeps accounting, reconciliation, profitability and reporting."
      />
      <Card className="surface-card mt-3">
        <Card.Body className="d-flex flex-wrap gap-2">
          {WEBSITE_ADMIN_URL ? (
            <Button as="a" href={`${WEBSITE_ADMIN_URL}${pathname}${search}`} target="_blank" rel="noopener noreferrer" className="premium-btn text-white">
              <BsBoxArrowUpRight aria-hidden="true" /> Open in the Website Tour Admin
            </Button>
          ) : (
            <p className="text-muted mb-0">Open this page from the Website Tour Admin.</p>
          )}
          <Button as={Link} to="/admin" variant="outline-secondary">Back to the Back Office dashboard</Button>
        </Card.Body>
      </Card>
    </div>
  );
};

export default WebsiteOnlyPage;

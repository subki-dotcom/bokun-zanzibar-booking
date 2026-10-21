import { Button, Card } from "react-bootstrap";
import { BsBoxArrowUpRight } from "react-icons/bs";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "./PageHeader";
import { BACK_OFFICE_URL } from "../../config/site";
import { WEBSITE_ADMIN_HOME } from "../../config/adminNavigation";

// Shown in the website's /admin for sections and pages that live only in the Back Office app (the main dashboard,
// the booking register, CRM, accounting, reports, integrations, control and system). The pages are not mounted
// here at all.
const BackOfficeOnlyPage = () => {
  const { pathname, search } = useLocation();
  return (
    <div className="back-office-only-page">
      <PageHeader
        eyebrow="Back Office"
        title="This section is in the Back Office"
        description="The main dashboard, booking register, CRM, accounting, reports, integrations and system controls are available only in the Back Office."
      />
      <Card className="surface-card mt-3">
        <Card.Body className="d-flex flex-wrap gap-2">
          {BACK_OFFICE_URL ? (
            <Button as="a" href={`${BACK_OFFICE_URL}${pathname}${search}`} target="_blank" rel="noopener noreferrer" className="premium-btn text-white">
              <BsBoxArrowUpRight aria-hidden="true" /> Open in the Back Office
            </Button>
          ) : (
            <p className="text-muted mb-0">Open this section from the Back Office.</p>
          )}
          <Button as={Link} to={WEBSITE_ADMIN_HOME} variant="outline-secondary">Back to Booking Requests</Button>
        </Card.Body>
      </Card>
    </div>
  );
};

export default BackOfficeOnlyPage;

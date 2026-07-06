import { useMemo, useState } from "react";
import { Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { readAgentDrafts, removeAgentDraft } from "../../utils/bookingSession";

const AgentDraftsPage = () => {
  const [version, setVersion] = useState(0);
  const drafts = useMemo(() => readAgentDrafts(), [version]);

  return (
    <>
      <h2 className="mb-1">Booking Drafts</h2>
      <p className="section-subtitle mb-4">Continue option-level booking sessions you started but did not finish.</p>
      <div className="agent-voucher-list">
        {drafts.map((draft) => {
          const query = new URLSearchParams();
          if (draft.tripDetails?.optionId) query.set("option", draft.tripDetails.optionId);
          if (draft.tripDetails?.travelDate) query.set("date", draft.tripDetails.travelDate);
          if (draft.tripDetails?.rateId) query.set("catalog", draft.tripDetails.rateId);
          if (draft.tripDetails?.startTime) query.set("time", draft.tripDetails.startTime);
          if (draft.tripDetails?.passengers?.length) query.set("passengers", JSON.stringify(draft.tripDetails.passengers));
          const path = `/agent/new-booking/${draft.product?.slug}/checkout?${query.toString()}`;
          return (
            <Card className="surface-card" key={draft.id}>
              <Card.Body className="d-flex flex-wrap justify-content-between align-items-center gap-3">
                <div>
                  <strong>{draft.product?.title || "Booking draft"}</strong>
                  <div className="text-muted small">{draft.tripDetails?.optionTitle || "Option"} • {draft.tripDetails?.travelDate || "No date"} • {new Date(draft.updatedAt).toLocaleString()}</div>
                </div>
                <div className="d-flex gap-2">
                  <Button as={Link} to={path} className="agent-primary-btn">Continue</Button>
                  <Button variant="outline-danger" onClick={() => { removeAgentDraft(draft.id); setVersion((prev) => prev + 1); }}>Remove</Button>
                </div>
              </Card.Body>
            </Card>
          );
        })}
        {!drafts.length ? <Card className="surface-card"><Card.Body className="text-muted">No saved drafts yet.</Card.Body></Card> : null}
      </div>
    </>
  );
};

export default AgentDraftsPage;

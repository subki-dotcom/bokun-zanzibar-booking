import { useEffect, useState } from "react";
import { Button, Card } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import { fetchAgentBookingVoucher, resendAgentBookingVoucher } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const VoucherLine = ({ label, value }) => (
  <div className="voucher-line">
    <span>{label}</span>
    <strong>{value || "-"}</strong>
  </div>
);

const AgentVoucherPage = () => {
  const { reference } = useParams();
  const [voucher, setVoucher] = useState(null);
  const [share, setShare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setVoucher(await fetchAgentBookingVoucher(reference));
      } catch (err) {
        setError(err.message || "Failed to load voucher");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reference]);

  if (loading) return <Loader message="Loading voucher..." />;

  const handlePrepareShare = async () => {
    try {
      setActionLoading(true);
      setError("");
      const data = await resendAgentBookingVoucher(reference);
      setShare(data);
    } catch (err) {
      setError(err.message || "Could not prepare voucher share");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <div className="agent-page-head no-print">
        <div>
          <h2 className="mb-1">Customer Voucher</h2>
          <p className="section-subtitle mb-0">{voucher?.bookingReference}</p>
        </div>
        <div className="agent-desk-actions">
          <Button variant="outline-success" onClick={() => window.print()}>
            Print / Download PDF
          </Button>
          <Button variant="outline-primary" disabled={actionLoading} onClick={handlePrepareShare}>
            {actionLoading ? "Preparing..." : "Resend / Share"}
          </Button>
          <Button as={Link} to={`/agent/bookings/${reference}`} variant="outline-secondary">
            Back
          </Button>
        </div>
      </div>
      <ErrorAlert error={error} />
      {share ? (
        <Card className="surface-card mb-3 no-print">
          <Card.Body className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div>
              <strong>Share voucher</strong>
              <div className="text-muted small">Use WhatsApp or email to send this voucher to the customer.</div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              {share.whatsappUrl ? <Button as="a" href={share.whatsappUrl} target="_blank" rel="noreferrer" variant="success">WhatsApp</Button> : null}
              {share.mailtoUrl ? <Button as="a" href={share.mailtoUrl} variant="outline-primary">Email</Button> : null}
            </div>
          </Card.Body>
        </Card>
      ) : null}
      <Card className="surface-card agent-voucher-card">
        <Card.Body>
          <div className="voucher-brand agent-voucher-hero">
            <div>
              <span className="voucher-kicker">Tour Voucher</span>
              <h3>Riser Tours & Safaris</h3>
              <p>Zanzibar Tours, Activities & Transfers</p>
            </div>
            <strong>{voucher?.bookingReference}</strong>
          </div>

          <div className="agent-voucher-grid">
            <div>
              <h5>Customer</h5>
              <VoucherLine label="Name" value={voucher?.customerName} />
              <VoucherLine label="Payment Status" value={voucher?.paymentStatus} />
              <VoucherLine label="Booking Status" value={voucher?.bookingStatus} />
            </div>
            <div>
              <h5>Tour</h5>
              <VoucherLine label="Tour Name" value={voucher?.tourName} />
              <VoucherLine label="Selected Option" value={voucher?.selectedOption} />
              <VoucherLine label="Date" value={voucher?.date} />
              <VoucherLine label="Time" value={voucher?.time} />
            </div>
            <div>
              <h5>Pickup</h5>
              <VoucherLine label="Pickup / Meeting Point" value={voucher?.pickupLocation} />
              <VoucherLine
                label="Pax"
                value={`Adults ${voucher?.pax?.adults || 0}, Children ${voucher?.pax?.children || 0}, Infants ${voucher?.pax?.infants || 0}`}
              />
            </div>
          </div>

          {voucher?.inclusions?.length ? (
            <div className="agent-voucher-note-box">
              <h5>Inclusions</h5>
              <ul>
                {voucher.inclusions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}

          {voucher?.importantNotes?.length ? (
            <div className="agent-voucher-note-box">
              <h5>Important Notes</h5>
              <ul>
                {voucher.importantNotes.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="voucher-support">
            <strong>Emergency Contact / WhatsApp</strong>
            <span>+255 778 775 044</span>
            <span>info@risertoursandsafaris.co.tz</span>
          </div>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentVoucherPage;

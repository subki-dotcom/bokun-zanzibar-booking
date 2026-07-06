import { useEffect, useState } from "react";
import { Button, Card, Col, Form, Row } from "react-bootstrap";
import { fetchAgentPayoutMethod, updateAgentPayoutMethod } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const AgentPayoutMethodPage = () => {
  const [form, setForm] = useState({ payoutMethod: "mobile_money", accountHolderName: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAgentPayoutMethod();
        setForm((prev) => ({ ...prev, ...data, payoutMethod: data.payoutMethod || "mobile_money" }));
      } catch (err) {
        setError(err.message || "Failed to load payout method");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      setForm(await updateAgentPayoutMethod(form));
      setSuccess("Payout method updated.");
    } catch (err) {
      setError(err.message || "Could not update payout method");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader message="Loading payout method..." />;

  return (
    <>
      <h2 className="mb-1">Payout Method</h2>
      <p className="section-subtitle mb-4">Add commission payment details.</p>
      <ErrorAlert error={error} />
      {success ? <div className="alert alert-success">{success}</div> : null}
      <Card className="surface-card">
        <Card.Body>
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col md={6}><Form.Label>Payout Method</Form.Label><Form.Select value={form.payoutMethod || ""} onChange={(e) => update("payoutMethod", e.target.value)}><option value="bank_transfer">Bank Transfer</option><option value="mobile_money">Mobile Money</option><option value="cash">Cash</option><option value="paypal">PayPal</option><option value="wise">Wise</option><option value="other">Other</option></Form.Select></Col>
              <Col md={6}><Form.Label>Account Holder Name</Form.Label><Form.Control value={form.accountHolderName || ""} onChange={(e) => update("accountHolderName", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Bank Name</Form.Label><Form.Control value={form.bankName || ""} onChange={(e) => update("bankName", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Bank Account Number</Form.Label><Form.Control value={form.bankAccountNumber || ""} placeholder={form.bankAccountNumberMasked || ""} onChange={(e) => update("bankAccountNumber", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Bank Branch / SWIFT</Form.Label><Form.Control value={form.bankBranch || ""} onChange={(e) => update("bankBranch", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Mobile Money Provider</Form.Label><Form.Select value={form.mobileMoneyProvider || ""} onChange={(e) => update("mobileMoneyProvider", e.target.value)}><option value="">Select</option><option value="mpesa">M-Pesa</option><option value="tigo_pesa">Tigo Pesa</option><option value="airtel_money">Airtel Money</option><option value="halopesa">Halopesa</option><option value="other">Other</option></Form.Select></Col>
              <Col md={6}><Form.Label>Mobile Money Number</Form.Label><Form.Control value={form.mobileMoneyNumber || ""} placeholder={form.mobileMoneyNumberMasked || ""} onChange={(e) => update("mobileMoneyNumber", e.target.value)} /></Col>
              <Col md={6}><Form.Label>PayPal Email</Form.Label><Form.Control type="email" value={form.paypalEmail || ""} onChange={(e) => update("paypalEmail", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Wise Email</Form.Label><Form.Control type="email" value={form.wiseEmail || ""} onChange={(e) => update("wiseEmail", e.target.value)} /></Col>
              <Col md={12}><Form.Label>Payout Notes</Form.Label><Form.Control as="textarea" rows={3} value={form.payoutNotes || ""} onChange={(e) => update("payoutNotes", e.target.value)} /></Col>
            </Row>
            <Button type="submit" className="premium-btn text-white mt-4" disabled={saving}>{saving ? "Saving..." : "Save Payout Method"}</Button>
          </Form>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentPayoutMethodPage;

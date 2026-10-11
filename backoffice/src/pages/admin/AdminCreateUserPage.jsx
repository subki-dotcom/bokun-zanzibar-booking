import { useRef, useState } from "react";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { registerAdminSeed } from "../../../../shared/src/api/authApi";

const emptyForm = { firstName: "", lastName: "", email: "", password: "", confirmation: "" };

export default function AdminCreateUserPage() {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const pending = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    setCreated(null);
    if (form.password !== form.confirmation) return setError("Passwords do not match.");
    if (form.password.length < 12 || new TextEncoder().encode(form.password).length > 72) {
      return setError("Use at least 12 characters and no more than 72 UTF-8 bytes for the password.");
    }
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      return setError("First name and last name must each contain at least two characters.");
    }
    pending.current = true;
    setBusy(true);
    try {
      const account = await registerAdminSeed({
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(), password: form.password, role: "admin"
      });
      setCreated(account);
      setForm({ ...emptyForm });
    } catch (err) {
      setError(err.message || "Could not create the admin account. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <section className="p-3" style={{ maxWidth: 720 }}>
    <h1>Create Admin</h1>
    <p>Create an admin account using an email address the person can access. Only a super admin can create accounts.</p>
    {error && <Alert variant="danger" role="alert">{error}</Alert>}
    {created && <Alert variant="success" role="status">Admin account created for {created.email}. They can now sign in using the password you set. Your own session is unchanged.</Alert>}
    <Card><Card.Body><Form onSubmit={submit}>
      <fieldset disabled={busy}>
        {[
          ["firstName", "First name", "text", "off", 2, 100],
          ["lastName", "Last name", "text", "off", 2, 100],
          ["email", "Email address", "email", "off", undefined, 254],
          ["password", "Password", "password", "new-password", 12, 72],
          ["confirmation", "Confirm password", "password", "new-password", 12, 72]
        ].map(([name, label, type, autoComplete, minLength, maxLength]) => <Form.Group key={name} controlId={`create-admin-${name}`} className="mb-3">
          <Form.Label>{label}</Form.Label>
          <Form.Control required type={type} autoComplete={autoComplete} minLength={minLength} maxLength={maxLength}
            value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
        </Form.Group>)}
        <p className="text-muted">Role: Admin. Use at least 12 characters for the password and share it securely with the account owner.</p>
        <Button type="submit" disabled={busy}>{busy ? "Creating admin..." : "Create admin"}</Button>
      </fieldset>
    </Form></Card.Body></Card>
  </section>;
}

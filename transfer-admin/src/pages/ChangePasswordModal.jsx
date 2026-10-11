import { useEffect, useState } from "react";
import { Form } from "react-bootstrap";
import { changePassword } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { FormModal } from "../components/ui";

// Changing the password signs out every other session; this one continues with a fresh token.
const ChangePasswordModal = ({ show, onHide }) => {
  const { replaceSession } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  useEffect(() => {
    if (show) setForm({ currentPassword: "", newPassword: "" });
  }, [show]);
  return (
    <FormModal show={show} title="Change password" onHide={onHide} submitLabel="Change password" onSubmit={async () => replaceSession(await changePassword(form))}>
      <Form.Group className="mb-3" controlId="ta-current-password">
        <Form.Label>Current password</Form.Label>
        <Form.Control type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required />
      </Form.Group>
      <Form.Group controlId="ta-new-password">
        <Form.Label>New password</Form.Label>
        <Form.Control type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} minLength={12} maxLength={72} required />
        <Form.Text>At least 12 characters with upper case, lower case and a number. Other sessions will be signed out.</Form.Text>
      </Form.Group>
    </FormModal>
  );
};

export default ChangePasswordModal;

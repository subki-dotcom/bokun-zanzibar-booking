import { useState } from "react";
import { Badge, Button, Card, Form, Table } from "react-bootstrap";
import { createUser, fetchUsers, resetUserPassword, updateUser } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorMessage, FormModal, Loading, PageHeader, useResource } from "../components/ui";
import { dateTime } from "../lib/format";
import { ROLES, roleLabel } from "../lib/permissions";

const ROLE_HELP = {
  transfer_admin: "Everything, including users, prices and the audit log",
  transfer_manager: "Bookings, manual bookings, dispatch, fleet, costs and reports",
  dispatcher: "Sees bookings and assigns drivers and vehicles",
  transfer_accountant: "Payments, costs and reports; sees bookings and prices"
};

const PASSWORD_HINT = "At least 12 characters with upper case, lower case and a number.";

const UserModal = ({ user, show, onHide, onSaved }) => {
  const [form, setForm] = useState({});
  const value = (field, fallback = "") => form[field] ?? user?.[field] ?? fallback;
  const submit = async () => {
    if (user) await updateUser(user.id, { name: value("name"), role: value("role"), reason: form.reason || undefined });
    else await createUser({ name: value("name"), email: value("email"), role: value("role", "dispatcher"), password: form.password || "" });
    setForm({});
    onSaved();
  };
  return (
    <FormModal show={show} title={user ? `Edit ${user.name}` : "New user"} onHide={() => { setForm({}); onHide(); }} onSubmit={submit}>
      <Form.Group className="mb-3" controlId="user-name"><Form.Label>Name</Form.Label><Form.Control value={value("name")} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={100} required /></Form.Group>
      {!user ? <Form.Group className="mb-3" controlId="user-email"><Form.Label>Email</Form.Label><Form.Control type="email" value={value("email")} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Form.Group> : null}
      <Form.Group className="mb-3" controlId="user-role">
        <Form.Label>Role</Form.Label>
        <Form.Select value={value("role", "dispatcher")} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ROLES.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</Form.Select>
        <Form.Text>{ROLE_HELP[value("role", "dispatcher")]}. Changing a role signs the user out.</Form.Text>
      </Form.Group>
      {!user ? (
        <Form.Group controlId="user-password">
          <Form.Label>Temporary password</Form.Label>
          <Form.Control type="password" autoComplete="new-password" value={form.password || ""} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={12} maxLength={72} required />
          <Form.Text>{PASSWORD_HINT} Share it privately; the user can change it after signing in.</Form.Text>
        </Form.Group>
      ) : (
        <Form.Group controlId="user-reason"><Form.Label>Reason (optional)</Form.Label><Form.Control value={form.reason || ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} /></Form.Group>
      )}
    </FormModal>
  );
};

const ResetPasswordModal = ({ user, show, onHide, onSaved }) => {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  return (
    <FormModal show={show} title={`Reset password for ${user?.name || ""}`} submitLabel="Reset password" variant="warning" onHide={() => { setPassword(""); setReason(""); onHide(); }}
      onSubmit={async () => { await resetUserPassword(user.id, { password, reason: reason || undefined }); setPassword(""); setReason(""); onSaved(); }}>
      <p className="small">The user is signed out everywhere and any lockout is cleared.</p>
      <Form.Group className="mb-3" controlId="reset-password"><Form.Label>New temporary password</Form.Label><Form.Control type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={72} required /><Form.Text>{PASSWORD_HINT}</Form.Text></Form.Group>
      <Form.Group controlId="reset-reason"><Form.Label>Reason (optional)</Form.Label><Form.Control value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Form.Group>
    </FormModal>
  );
};

const UsersPage = () => {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useResource(() => fetchUsers(), []);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [actionError, setActionError] = useState(null);

  const act = async (fn) => {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (failure) {
      setActionError(failure);
    }
  };

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Transfer Admin accounts. They are separate from Back Office and agent accounts." actions={<Button size="sm" onClick={() => setEditing("new")}>New user</Button>} />
      <ErrorMessage error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.map((account) => (
                  <tr key={account.id}>
                    <td><strong>{account.name}</strong>{account.id === me.id ? <Badge bg="light" text="dark" className="ms-1">you</Badge> : null}<div className="small text-muted">{account.email}</div></td>
                    <td>{roleLabel(account.role)}</td>
                    <td>
                      {account.isActive ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Disabled</Badge>}
                      {account.lockedUntil ? <Badge bg="danger" className="ms-1">Locked until {dateTime(account.lockedUntil)}</Badge> : null}
                    </td>
                    <td className="small">{dateTime(account.lastLoginAt)}</td>
                    <td className="text-end text-nowrap">
                      <Button size="sm" variant="outline-secondary" onClick={() => setEditing(account)}>Edit</Button>{" "}
                      <Button size="sm" variant="outline-warning" onClick={() => setResetting(account)}>Reset password</Button>{" "}
                      {account.lockedUntil ? <><Button size="sm" variant="outline-primary" onClick={() => act(() => updateUser(account.id, { unlock: true, reason: "Unlocked from the users list" }))}>Unlock</Button>{" "}</> : null}
                      {account.id !== me.id ? (
                        <Button size="sm" variant={account.isActive ? "outline-danger" : "outline-success"} onClick={() => act(() => updateUser(account.id, { isActive: !account.isActive, reason: account.isActive ? "Disabled from the users list" : "Re-enabled from the users list" }))}>
                          {account.isActive ? "Disable" : "Enable"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>No users.</Empty>
        )
      ) : null}
      <UserModal key={editing?.id || editing || "none"} user={editing && editing !== "new" ? editing : null} show={Boolean(editing)} onHide={() => setEditing(null)} onSaved={reload} />
      <ResetPasswordModal user={resetting} show={Boolean(resetting)} onHide={() => setResetting(null)} onSaved={reload} />
    </>
  );
};

export default UsersPage;

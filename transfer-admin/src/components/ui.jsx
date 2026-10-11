import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Pagination, Spinner } from "react-bootstrap";
import { useAuth } from "../auth/AuthContext";
import { can } from "../lib/permissions";
import { statusMeta } from "../lib/format";

// Loads data and reloads on demand; ignores responses that arrive after the component changed its request.
export const useResource = (load, deps = []) => {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const call = ++latest.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await load();
      if (call === latest.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (call === latest.current) setState((current) => ({ ...current, loading: false, error }));
    }
    // The caller's deps decide when load changes.
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
};

export const PageHeader = ({ title, subtitle, actions }) => (
  <header className="ta-page-header">
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
    {actions ? <div className="ta-page-actions">{actions}</div> : null}
  </header>
);

export const StatusBadge = ({ status }) => {
  const meta = statusMeta(status);
  return (
    <Badge bg={meta.bg} text={meta.text} className="ta-status">
      {meta.label}
    </Badge>
  );
};

export const ErrorMessage = ({ error, onRetry }) =>
  error ? (
    <Alert variant="danger" role="alert" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
      <span>{error.message || "Something went wrong."}</span>
      {onRetry ? <Button size="sm" variant="outline-danger" onClick={onRetry}>Retry</Button> : null}
    </Alert>
  ) : null;

export const Loading = ({ label = "Loading…" }) => (
  <div className="ta-loading" role="status">
    <Spinner animation="border" size="sm" /> <span>{label}</span>
  </div>
);

export const Empty = ({ children }) => <p className="ta-empty">{children}</p>;

export const Pager = ({ pagination, onPage }) => {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = pagination;
  const first = (page - 1) * limit + 1;
  return (
    <div className="ta-pager">
      <span>
        {first}–{Math.min(page * limit, total)} of {total}
      </span>
      <Pagination size="sm" className="mb-0">
        <Pagination.Prev disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <Pagination.Item active>{page}</Pagination.Item>
        <Pagination.Next disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </Pagination>
    </div>
  );
};

// A modal wrapping a form. onSubmit returns a promise; errors are shown inside the modal.
export const FormModal = ({ show, title, onHide, onSubmit, submitLabel = "Save", variant = "primary", children, size }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (show) setError(null);
  }, [show]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onHide();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal show={show} onHide={busy ? undefined : onHide} centered size={size}>
      <Form onSubmit={submit}>
        <Modal.Header closeButton={!busy}>
          <Modal.Title as="h2" className="h5">{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {children}
          <ErrorMessage error={error} />
          {error?.details?.fieldErrors?.body ? <div className="small text-danger">{error.details.fieldErrors.body.join(" ")}</div> : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onHide} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={variant} disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

// Every sensitive action asks for a reason, which goes into the audit log.
export const ReasonModal = ({ show, title, description, submitLabel, variant, onHide, onSubmit }) => {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (show) setReason("");
  }, [show]);
  return (
    <FormModal show={show} title={title} onHide={onHide} onSubmit={() => onSubmit(reason)} submitLabel={submitLabel} variant={variant}>
      {description ? <p>{description}</p> : null}
      <Form.Group controlId="ta-reason">
        <Form.Label>Reason (saved in the audit log)</Form.Label>
        <Form.Control as="textarea" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
      </Form.Group>
    </FormModal>
  );
};

export const RequirePermission = ({ permission, children }) => {
  const { user } = useAuth();
  if (!can(user, permission)) {
    return (
      <Alert variant="warning" role="alert">
        Your role does not have access to this page.
      </Alert>
    );
  }
  return children;
};

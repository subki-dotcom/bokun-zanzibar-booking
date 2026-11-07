import { useEffect, useState } from "react";
import { Button, Modal, Toast, ToastContainer } from "react-bootstrap";
import { BsCheckCircleFill, BsExclamationOctagonFill } from "react-icons/bs";

// Admin-wide feedback: toasts (top-right) for saved/failed actions and a confirm dialog for destructive ones.
// <AdminFeedbackHost /> is rendered once in AdminLayout; pages call adminToast.* and confirmAction().
const toastListeners = new Set();
const confirmListeners = new Set();
let nextId = 1;

const emitToast = (variant, message) => {
  const text = String(message || "").trim();
  if (!text) return;
  toastListeners.forEach((listener) => listener({ id: nextId++, variant, message: text }));
};

export const adminToast = {
  success: (message) => emitToast("success", message),
  error: (message) => emitToast("danger", message)
};

// Resolves true when the user confirms, false when they cancel. Falls back to window.confirm if no host is mounted.
export const confirmAction = ({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = true } = {}) => {
  if (!confirmListeners.size) return Promise.resolve(window.confirm([title, message].filter(Boolean).join("\n\n")));
  return new Promise((resolve) => {
    confirmListeners.forEach((listener) => listener({ title, message, confirmLabel, cancelLabel, danger, resolve }));
  });
};

// Shows a page's success message as a toast and clears it, so pages keep their existing "message" state.
export const useToastMessage = (message, clear) => {
  useEffect(() => {
    if (!message) return;
    adminToast.success(message);
    clear?.("");
  }, [message, clear]);
};

export function AdminFeedbackHost() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    const onToast = (toast) => setToasts((current) => [...current.slice(-3), toast]);
    const onConfirm = (request) => setDialog(request);
    toastListeners.add(onToast);
    confirmListeners.add(onConfirm);
    return () => {
      toastListeners.delete(onToast);
      confirmListeners.delete(onConfirm);
    };
  }, []);

  const close = (id) => setToasts((current) => current.filter((toast) => toast.id !== id));
  const answer = (value) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  return (
    <>
      <ToastContainer position="top-end" className="adm-toasts" containerPosition="fixed">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            onClose={() => close(toast.id)}
            delay={toast.variant === "danger" ? 8000 : 4000}
            autohide
            className={`adm-toast is-${toast.variant}`}
            role={toast.variant === "danger" ? "alert" : "status"}
          >
            <Toast.Body>
              {toast.variant === "danger" ? <BsExclamationOctagonFill aria-hidden="true" /> : <BsCheckCircleFill aria-hidden="true" />}
              <span>{toast.message}</span>
              <button type="button" className="btn-close" aria-label="Dismiss notification" onClick={() => close(toast.id)} />
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>

      <Modal show={Boolean(dialog)} onHide={() => answer(false)} centered className="adm-confirm">
        <Modal.Header closeButton>
          <Modal.Title>{dialog?.title}</Modal.Title>
        </Modal.Header>
        {dialog?.message ? <Modal.Body>{dialog.message}</Modal.Body> : null}
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => answer(false)}>{dialog?.cancelLabel}</Button>
          <Button variant={dialog?.danger ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>
            {dialog?.confirmLabel}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

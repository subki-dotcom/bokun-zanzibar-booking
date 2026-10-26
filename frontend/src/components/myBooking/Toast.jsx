import { createPortal } from "react-dom";
import { LuCircleCheck } from "react-icons/lu";

// Announced to screen readers (the live region is always present; the message appears inside it).
const Toast = ({ message = "" }) =>
  createPortal(
    <div className="mb-layer" aria-live="polite" role="status">
      {message ? (
        <div className="mb-toast">
          <LuCircleCheck aria-hidden="true" /> {message}
        </div>
      ) : null}
    </div>,
    document.body
  );

export default Toast;

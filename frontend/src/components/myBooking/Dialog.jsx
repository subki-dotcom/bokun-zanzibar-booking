import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import useDialogFocus from "../common/siteHeader/useDialogFocus";

// A modal (a bottom sheet on phones): role="dialog", focus kept inside, Esc and the backdrop close it.
const Dialog = ({ title, onClose, children, labelledBy = "", initialFocus = null, busy = false }) => {
  const panel = useRef(null);
  const fallbackId = useId();
  const titleId = labelledBy || fallbackId;
  useDialogFocus(panel, () => !busy && onClose(), { initialFocus });
  return createPortal(
    <div className="mb-layer">
      <div className="mb-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
        <div ref={panel} className="mb-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          {title ? <h2 id={titleId}>{title}</h2> : null}
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Dialog;

import { useEffect, useState } from "react";

// True while the on-screen keyboard takes a large part of the viewport (the bar then steps aside).
const useKeyboardOpen = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const update = () => setOpen(window.innerHeight - viewport.height > 150);
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  return open;
};

// Fixed bar on phones: the total and the open step's button ("Next: Activity details", "Next: Payment", "Pay … & book").
const MobileCheckoutBar = ({ total, label, onAction, busy = false, disabled = false }) => {
  const keyboardOpen = useKeyboardOpen();

  // The focused field scrolls clear of the keyboard.
  useEffect(() => {
    const onFocus = (event) => {
      if (!event.target.matches?.("input, textarea, select")) return;
      setTimeout(() => event.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  return (
    <div className={`ck-mbar ${keyboardOpen ? "is-hidden" : ""}`}>
      <div className="ck-mbar-total">
        <small>Total</small>
        <strong>{total}</strong>
      </div>
      <button type="button" className="ck-btn" onClick={onAction} disabled={disabled || busy} aria-busy={busy || undefined}>
        {busy ? <span className="ck-spinner" aria-hidden="true" /> : null}
        {label}
      </button>
    </div>
  );
};

export default MobileCheckoutBar;

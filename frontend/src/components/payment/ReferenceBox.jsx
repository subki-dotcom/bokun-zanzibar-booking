import { useEffect, useRef, useState } from "react";

// Booking reference on one line with a Copy pill; "Copied" is announced to screen readers.
const ReferenceBox = ({ reference = "", className = "" }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      // Older browsers: select the text so the guest can copy it themselves.
      const range = document.createRange();
      const node = document.getElementById("pf-reference-value");
      if (node) {
        range.selectNodeContents(node);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`pf-reference ${className}`.trim()}>
      <span className="pf-reference-text">
        <small>Booking reference</small>
        <strong id="pf-reference-value">{reference || "—"}</strong>
      </span>
      <button type="button" className="pf-pill" onClick={copy} disabled={!reference}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="ck-visually-hidden" aria-live="polite">{copied ? "Booking reference copied" : ""}</span>
    </div>
  );
};

export default ReferenceBox;

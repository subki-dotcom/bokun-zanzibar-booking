// Personal data shown masked by the server ("A•••• B••••"); screen readers hear that it is hidden.
const MaskedText = ({ value = "", label = "" }) => (
  <>
    <span aria-hidden="true">{value || "—"}</span>
    <span className="mb-visually-hidden">{label ? `${label} hidden for privacy` : "Hidden for privacy"}</span>
  </>
);

export default MaskedText;

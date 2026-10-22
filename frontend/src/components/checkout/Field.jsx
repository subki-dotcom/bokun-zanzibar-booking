// A labelled form field: label above, helper text below, or the error in its place.
// The control gets the matching aria-describedby / aria-invalid from fieldProps().
export const fieldProps = (id, { helper = "", error = "" } = {}) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : helper ? `${id}-help` : undefined
});

const Field = ({ id, label, helper = "", error = "", className = "", children, labelFor }) => (
  <div className={`ck-field ${error ? "has-error" : ""} ${className}`.trim()}>
    <label htmlFor={labelFor || id}>{label}</label>
    {children}
    {error ? (
      <small id={`${id}-error`} className="ck-error">{error}</small>
    ) : helper ? (
      <small id={`${id}-help`} className="ck-help">{helper}</small>
    ) : null}
  </div>
);

export default Field;

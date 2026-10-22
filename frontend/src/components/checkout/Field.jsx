import { useEffect, useState } from "react";

// A labelled form field: label above, helper text below, or the error in its place.
// The control gets the matching aria-describedby / aria-invalid from fieldProps().
export const fieldProps = (id, { helper = "", error = "" } = {}) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : helper ? `${id}-help` : undefined
});

// Focuses the first field with an error after a failed "Next" (from the step or the mobile bar).
export const useStepAttempt = (attempt, errors, order, idFor) => {
  const [touched, setTouched] = useState({});
  useEffect(() => {
    if (!attempt) return;
    setTouched(Object.fromEntries(order.map((field) => [field, true])));
    const first = order.find((field) => errors[field]);
    if (first) document.getElementById(idFor(first))?.focus();
    // Only on a new attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const touch = (field) => setTouched((current) => ({ ...current, [field]: true }));
  const shown = (field) => (touched[field] ? errors[field] || "" : "");
  return { touch, shown };
};

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

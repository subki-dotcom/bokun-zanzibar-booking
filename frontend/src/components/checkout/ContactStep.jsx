import { useEffect, useRef, useState } from "react";
import Field, { fieldProps } from "./Field";
import PhoneInput from "./PhoneInput";

const FIELDS = ["firstName", "lastName", "email", "phone"];

// Focuses the first field with an error after a failed "Next" (from the step or the mobile bar).
export const useStepAttempt = (attempt, errors, order, scope) => {
  const [touched, setTouched] = useState({});
  useEffect(() => {
    if (!attempt) return;
    setTouched(Object.fromEntries(order.map((field) => [field, true])));
    const first = order.find((field) => errors[field]);
    if (first) document.getElementById(`${scope}-${first}`)?.focus();
    // Only on a new attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const touch = (field) => setTouched((current) => ({ ...current, [field]: true }));
  const shown = (field) => (touched[field] ? errors[field] || "" : "");
  return { touch, shown };
};

// Step 1: lead traveler name, email and WhatsApp number. Errors show when a field is left, or after "Next".
const ContactStep = ({ checkout, attempt, onNext }) => {
  const { form, setField } = checkout;
  const errors = checkout.errorsFor("contact");
  const { touch, shown } = useStepAttempt(attempt, errors, FIELDS, "ck");
  const phoneEdited = useRef(false);

  const text = (field, label, { placeholder = "", autoComplete = "", type = "text", helper = "" } = {}) => (
    <Field id={`ck-${field}`} label={label} helper={helper} error={shown(field)}>
      <input
        {...fieldProps(`ck-${field}`, { helper, error: shown(field) })}
        type={type}
        value={form[field]}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => setField(field, event.target.value)}
        onBlur={() => touch(field)}
      />
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
    >
      <div className="ck-grid">
        {text("firstName", "First name", { placeholder: "e.g. Amina", autoComplete: "given-name" })}
        {text("lastName", "Last name", { placeholder: "e.g. Smith", autoComplete: "family-name" })}
        {text("email", "Email", { placeholder: "you@example.com", autoComplete: "email", type: "email", helper: "Your confirmation is sent here" })}
        <Field id="ck-phone" label="Phone (WhatsApp)" helper="For pickup updates from your guide" error={shown("phone")}>
          <PhoneInput
            id="ck-phone"
            country={form.phoneCountry}
            value={form.phoneNational}
            onCountry={(iso) => setField("phoneCountry", iso)}
            onChange={(value) => {
              phoneEdited.current = true;
              setField("phoneNational", value);
            }}
            onBlur={() => phoneEdited.current && touch("phone")}
            inputProps={fieldProps("ck-phone", { helper: "For pickup updates from your guide", error: shown("phone") })}
          />
        </Field>
      </div>
      <label className="ck-check">
        <input type="checkbox" checked={Boolean(form.marketingConsent)} onChange={(event) => setField("marketingConsent", event.target.checked)} />
        <span>Send me Zanzibar travel tips and offers (optional)</span>
      </label>
      <div className="ck-step-actions">
        <button type="submit" className="ck-btn">Next</button>
      </div>
    </form>
  );
};

export default ContactStep;

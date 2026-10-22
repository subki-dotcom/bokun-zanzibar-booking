import { useRef } from "react";
import Field, { fieldProps, useStepAttempt } from "./Field";
import PhoneInput from "./PhoneInput";

const FIELDS = ["firstName", "lastName", "email", "phone"];

// Step 1: lead traveler name, email and WhatsApp number. Errors show when a field is left, or after "Next".
const ContactStep = ({ checkout, attempt, onNext }) => {
  const { form, setField } = checkout;
  const errors = checkout.errorsFor("contact");
  const { touch, shown } = useStepAttempt(attempt, errors, FIELDS, (field) => `ck-${field}`);
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

import { LuMapPin } from "react-icons/lu";
import Field, { fieldProps, useStepAttempt } from "./Field";
import PickupHotelSearch from "./PickupHotelSearch";

const questionKey = (question) => `q:${question.questionId || question.id}`;
const questionFieldId = (question) => `ck-q-${String(question.questionId || question.id).replace(/[^\w-]/g, "")}`;

// Step 2: pickup hotel (or meeting point), room, tour language, special requirements and any extra questions the tour asks.
const ActivityStep = ({ checkout, attempt, busy = false, onNext }) => {
  const { form, setField, languages, extraQuestions } = checkout;
  const errors = checkout.errorsFor("activity");
  const order = ["hotel", ...extraQuestions.map(questionKey)];
  const ids = Object.fromEntries([["hotel", "ck-hotel"], ...extraQuestions.map((question) => [questionKey(question), questionFieldId(question)])]);
  const { touch, shown } = useStepAttempt(attempt, errors, order, (key) => ids[key]);
  const errorFor = shown;

  const mapHref = checkout.meetingPoint ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(checkout.meetingPoint)}` : "";

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
    >
      <div className="ck-grid">
        {checkout.hasPickup ? (
          <PickupHotelSearch checkout={checkout} error={errorFor("hotel")} onBlur={() => touch("hotel")} />
        ) : (
          <div className="ck-field is-wide">
            <span className="ck-label">Meeting point</span>
            <p className="ck-meeting">
              <LuMapPin aria-hidden="true" />
              <span>{checkout.meetingPoint || "The meeting point is in your confirmation email."}</span>
            </p>
            {mapHref ? (
              <a className="ck-link" href={mapHref} target="_blank" rel="noreferrer">Open in Google Maps</a>
            ) : null}
          </div>
        )}

        {checkout.hasPickup ? (
          <Field id="ck-room" label="Room number (optional)">
            <input id="ck-room" type="text" value={form.roomNumber} placeholder="e.g. 12" onChange={(event) => setField("roomNumber", event.target.value)} />
          </Field>
        ) : null}

        {languages.length > 1 ? (
          <Field id="ck-language" label="Tour language">
            <select id="ck-language" value={checkout.language} onChange={(event) => setField("language", event.target.value)}>
              {languages.map((language) => (
                <option key={language} value={language}>{language}</option>
              ))}
            </select>
          </Field>
        ) : languages.length === 1 ? (
          <div className="ck-field">
            <span className="ck-label">Tour language</span>
            <p className="ck-static">{languages[0]}</p>
          </div>
        ) : null}

        <Field id="ck-notes" label="Special requirements (optional)" className="is-wide">
          <textarea
            id="ck-notes"
            rows={3}
            maxLength={500}
            value={form.notes}
            placeholder="Dietary needs, mobility, children's ages, swimming ability…"
            onChange={(event) => setField("notes", event.target.value)}
          />
        </Field>

        {extraQuestions.map((question) => {
          const key = questionKey(question);
          const id = questionFieldId(question);
          const error = errorFor(key);
          const value = checkout.answerFor(question);
          const options = question.options || [];
          const isSelect = Boolean(question.selectFromOptions || options.length);
          const isTextarea = /textarea/i.test(String(question.type || ""));
          const props = {
            ...fieldProps(id, { helper: question.help, error }),
            value,
            onChange: (event) => checkout.setAnswer(question, event.target.value),
            onBlur: () => touch(key)
          };
          return (
            <Field key={key} id={id} label={question.label || "Additional information"} helper={question.help || ""} error={error} className="is-wide">
              {isSelect ? (
                <select {...props}>
                  <option value="">Select an option</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label || option.value}</option>
                  ))}
                </select>
              ) : isTextarea ? (
                <textarea {...props} rows={3} placeholder={question.placeholder || ""} />
              ) : (
                <input {...props} type="text" placeholder={question.placeholder || ""} />
              )}
            </Field>
          );
        })}
      </div>
      {checkout.activityError ? <p className="ck-notice is-error ck-inline-notice" role="alert">{checkout.activityError}</p> : null}
      <div className="ck-step-actions">
        <button type="submit" className="ck-btn" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <span className="ck-spinner" aria-hidden="true" /> : null}
          {busy ? "Checking the latest price…" : "Next"}
        </button>
      </div>
    </form>
  );
};

export default ActivityStep;

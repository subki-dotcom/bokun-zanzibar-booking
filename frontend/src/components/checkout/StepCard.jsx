import { LuCheck } from "react-icons/lu";

// One checkout step: open (number, title, intro and the form), done (check, summary, Edit) or locked (muted).
const StepCard = ({ id, number, title, intro = "", status = "locked", summary = "", onEdit, headingRef, children }) => {
  const headingId = `ck-step-${id}-title`;

  if (status === "open") {
    return (
      <section className="ck-step is-open" id={`step-${id}`} aria-labelledby={headingId}>
        <div className="ck-step-head">
          <span className="ck-step-num" aria-hidden="true">{number}</span>
          <h2 id={headingId} tabIndex={-1} ref={headingRef}>
            <span className="ck-visually-hidden">Step {number}: </span>
            {title}
          </h2>
        </div>
        {intro ? <p className="ck-step-intro">{intro}</p> : null}
        <div className="ck-step-body">{children}</div>
      </section>
    );
  }

  const done = status === "done";
  return (
    <section className={`ck-step ${done ? "is-done" : "is-locked"}`} id={`step-${id}`} aria-labelledby={headingId}>
      <div className="ck-step-row">
        <span className="ck-step-num" aria-hidden="true">{done ? <LuCheck /> : number}</span>
        <div className="ck-step-text">
          <h2 id={headingId} tabIndex={-1} ref={headingRef}>
            <span className="ck-visually-hidden">Step {number}: </span>
            {title}
            {done ? <span className="ck-visually-hidden"> (completed)</span> : null}
          </h2>
          {done && summary ? <p>{summary}</p> : null}
        </div>
        {done && onEdit ? (
          <button type="button" className="ck-edit" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
            Edit
          </button>
        ) : null}
      </div>
    </section>
  );
};

export default StepCard;

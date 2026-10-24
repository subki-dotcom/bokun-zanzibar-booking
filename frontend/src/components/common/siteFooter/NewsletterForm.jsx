import { useId, useState } from "react";
import { captureMarketingLead } from "../../../api/marketingApi";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Email + "Join" in one pill. Feedback is read out (aria-live) and the page never reloads.
const NewsletterForm = () => {
  const inputId = useId();
  const messageId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ type: "", text: "" });
  const [sending, setSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setStatus({ type: "error", text: "Please enter a valid email address." });
      return;
    }
    setSending(true);
    setStatus({ type: "", text: "" });
    try {
      await captureMarketingLead({ email: value, stage: "newsletter", source: "footer_newsletter", newsletterConsent: true });
      setEmail("");
      setStatus({ type: "success", text: "Thanks! You're subscribed." });
    } catch (error) {
      setStatus({ type: "error", text: error.message || "We could not save your email. Please try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="sf-news" onSubmit={submit} noValidate>
      <p className="sf-news-label" aria-hidden="true">Newsletter</p>
      <div className="sf-news-pill">
        <label htmlFor={inputId} className="sf-visually-hidden">Email for our newsletter</label>
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={status.type === "error" || undefined}
          aria-describedby={messageId}
        />
        <button type="submit" disabled={sending}>{sending ? "Joining…" : "Join"}</button>
      </div>
      <p id={messageId} className={`sf-news-msg ${status.type ? `is-${status.type}` : ""}`} aria-live="polite">
        {status.text}
      </p>
    </form>
  );
};

export default NewsletterForm;

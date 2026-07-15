import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { BsEnvelopePaper } from "react-icons/bs";
import { captureMarketingLead } from "../../../api/marketingApi";

const FooterNewsletter = () => {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await captureMarketingLead({
        email: email.trim(),
        stage: "newsletter",
        source: "footer_newsletter",
        newsletterConsent: true
      });
      setSubscribed(true);
      setEmail("");
    } catch (requestError) {
      setError(requestError.message || "Could not save your subscription. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="premium-footer-newsletter">
      <div className="premium-footer-newsletter-copy">
        <div className="premium-footer-eyebrow">Stay Connected</div>
        <h3>Get Zanzibar travel updates, offers, and new experiences</h3>
        <p>
          Subscribe to receive tour inspiration, exclusive offers, and the latest bookable
          experiences.
        </p>
      </div>

      <div className="premium-footer-newsletter-form-wrap">
        <Form className="premium-footer-newsletter-form" onSubmit={handleSubmit}>
          <div className="premium-footer-input-wrap">
            <BsEnvelopePaper className="premium-footer-input-icon" />
            <Form.Control
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              aria-label="Newsletter email"
            />
          </div>
          <Button type="submit" className="premium-footer-newsletter-btn text-white" disabled={submitting}>
            {submitting ? "Saving..." : "Subscribe"}
          </Button>
        </Form>
        {subscribed ? (
          <p className="premium-footer-newsletter-success">
            Thank you. You are subscribed for Zanzibar updates.
          </p>
        ) : null}
        {error ? <p className="premium-footer-newsletter-success is-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
};

export default FooterNewsletter;

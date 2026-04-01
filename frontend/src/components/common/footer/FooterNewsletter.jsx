import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { BsEnvelopePaper } from "react-icons/bs";

const FooterNewsletter = () => {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }

    setSubscribed(true);
    setEmail("");
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
          <Button type="submit" className="premium-footer-newsletter-btn text-white">
            Subscribe
          </Button>
        </Form>
        {subscribed ? (
          <p className="premium-footer-newsletter-success">
            Thank you. You are subscribed for Zanzibar updates.
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default FooterNewsletter;

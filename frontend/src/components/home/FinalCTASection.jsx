import { Button, Container } from "react-bootstrap";

const FinalCTASection = () => (
  <section className="z-home-section z-home-final-cta-wrap">
    <Container>
      <article className="z-home-final-cta-banner">
        <div>
          <h3>Ready to explore Zanzibar?</h3>
          <p>Book unforgettable experiences with a trusted local team and live availability updates.</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button href="/tours" className="premium-btn text-white">
            View tours
          </Button>
          <Button
            as="a"
            href="https://wa.me/255777123456"
            target="_blank"
            rel="noreferrer"
            variant="outline-light"
          >
            Contact on WhatsApp
          </Button>
        </div>
      </article>
    </Container>
  </section>
);

export default FinalCTASection;

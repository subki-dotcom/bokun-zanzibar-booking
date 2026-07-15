import { Container } from "react-bootstrap";
import { useLocation } from "react-router-dom";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";

const legalContent = {
  privacy: {
    title: "Privacy Policy",
    intro: "Riser Tours & Safaris uses customer details only to arrange bookings, process payment, provide support, and send marketing updates when you opt in.",
    sections: [
      ["Information we use", "Booking details, contact details, selected tour information, and payment status are used to deliver and support your booking."],
      ["Your choices", "You can choose whether to receive travel updates and offers. You may ask us to update or remove your marketing contact details."],
      ["Contact", `For privacy questions, email ${BRAND.email}.`]
    ]
  },
  terms: {
    title: "Booking Terms",
    intro: "Bookings are subject to live supplier availability, the selected product terms, and confirmed payment.",
    sections: [
      ["Live availability and pricing", "Availability and price are confirmed with the supplier before payment. If either changes, you will be asked to review the updated details."],
      ["Payment and confirmation", "A booking is confirmed only after payment is verified and the supplier confirms the reservation."],
      ["Support", `For changes or booking support, contact ${BRAND.phone} or ${BRAND.email}.`]
    ]
  }
};

const LegalPage = () => {
  const type = useLocation().pathname.includes("privacy") ? "privacy" : "terms";
  const content = legalContent[type];

  return (
    <main className="legal-page py-5">
      <SeoHead title={`${content.title} | Riser Tours & Safaris`} description={content.intro} />
      <Container className="legal-page-shell">
        <article className="legal-page-card">
          <h1>{content.title}</h1>
          <p className="legal-page-intro">{content.intro}</p>
          {content.sections.map(([heading, body]) => (
            <section key={heading}>
              <h2>{heading}</h2>
              <p>{body}</p>
            </section>
          ))}
        </article>
      </Container>
    </main>
  );
};

export default LegalPage;

// The text of the simple information pages (/about, /contact, /faq, /cancellation-policy, /privacy, /terms).
// Edit freely: each page has a title, an intro and sections; a section may list links (phone, WhatsApp, email…).
import { SITE, whatsappLink } from "./site";

export const SITE_PAGES = {
  about: {
    path: "/about",
    title: "About us",
    description: `${SITE.name} is a Zanzibar team arranging island tours, safaris from Zanzibar and airport transfers.`,
    intro: `${SITE.name} is a local team in Zanzibar. We arrange island tours, safaris from Zanzibar and airport and ferry transfers, and we look after you from booking to the day of your trip.`,
    sections: [
      ["What we do", "Sea tours to Mnemba, the sandbanks and Prison Island; Stone Town and spice farm visits; private tours with your own guide and car; fly-in and day safaris to Tanzania's national parks; and transfers between the airport, the ferry and your hotel."],
      ["Booking with us", "Every tour shows live availability and its full price before you pay. You can pay by card, M-Pesa or PayPal, and your confirmation and ticket come by email."],
      ["Talk to us", "Not sure what to choose? Send us your dates and hotel on WhatsApp and we will suggest tours that fit."]
    ]
  },
  contact: {
    path: "/contact",
    title: "Contact us",
    description: `Contact ${SITE.name} on WhatsApp, by phone or by email.`,
    intro: "We are happy to help you plan your trip or with a booking you already have.",
    sections: [
      {
        heading: "Reach us",
        body: "WhatsApp is the quickest way to reach us.",
        links: [
          { label: "Chat on WhatsApp", href: whatsappLink(), external: true },
          { label: `Call ${SITE.phone}`, href: SITE.phoneHref },
          { label: SITE.email, href: `mailto:${SITE.email}` }
        ]
      },
      ["Where we are", `${SITE.address.locality}, ${SITE.address.country}.`],
      {
        heading: "Already booked?",
        body: "Find your booking with your reference and email to see your trip details, pickup and payment.",
        links: [{ label: "Open my booking", to: "/my-booking" }]
      }
    ]
  },
  faq: {
    path: "/faq",
    title: "Frequently asked questions",
    description: `Answers about booking, paying, pickup and cancelling with ${SITE.name}.`,
    intro: "Answers to the questions guests ask us most.",
    sections: [
      ["How do I book?", "Choose a tour, pick your date, time and number of travelers, add your contact details and pay. Availability and the full price are checked before you pay."],
      ["How can I pay?", "By card (Visa, Mastercard), M-Pesa or PayPal, depending on what is shown at checkout. Payments are handled by our payment providers; we never see your card number."],
      ["Is hotel pickup included?", "Many tours include pickup from your hotel. Each tour page says whether pickup is included and where."],
      ["Can I cancel?", "Most tours can be cancelled free of charge up to 24 hours before they start. The exact terms of each tour are shown on its page and at checkout. See our cancellation policy."],
      ["Where do I find my booking?", "Open My booking and enter your booking reference and email. Your confirmation email has a link too."],
      ["Can you help me plan?", "Yes. Send us your dates and hotel on WhatsApp and we will suggest tours that fit."]
    ]
  },
  "cancellation-policy": {
    path: "/cancellation-policy",
    title: "Cancellation policy",
    description: `How cancelling and refunds work for tours booked with ${SITE.name}.`,
    intro: "Most tours can be cancelled free of charge up to 24 hours before they start.",
    sections: [
      ["The terms of your tour", "Each tour shows its own cancellation terms on its page and at checkout. Those terms apply to your booking and are also in your confirmation email."],
      ["How to cancel", `Contact us with your booking reference on WhatsApp, by phone (${SITE.phone}) or by email (${SITE.email}).`],
      ["Refunds", "Refunds go back to the payment method you used. How long it takes to reach you depends on your bank or payment provider."],
      ["If we have to cancel", "If a tour cannot run (for example because of weather or safety), we will offer you another date or a full refund."]
    ]
  },
  privacy: {
    path: "/privacy",
    title: "Privacy Policy",
    description: `How ${SITE.name} uses your details.`,
    intro: `${SITE.name} uses customer details only to arrange bookings, process payment, provide support, and send marketing updates when you opt in.`,
    sections: [
      ["Information we use", "Booking details, contact details, selected tour information, and payment status are used to deliver and support your booking."],
      ["Your choices", "You can choose whether to receive travel updates and offers. You may ask us to update or remove your marketing contact details."],
      ["Contact", `For privacy questions, email ${SITE.email}.`]
    ]
  },
  terms: {
    path: "/terms",
    title: "Booking Terms",
    description: "The terms that apply to bookings.",
    intro: "Bookings are subject to live supplier availability, the selected product terms, and confirmed payment.",
    sections: [
      ["Live availability and pricing", "Availability and price are confirmed with the supplier before payment. If either changes, you will be asked to review the updated details."],
      ["Payment and confirmation", "A booking is confirmed only after payment is verified and the supplier confirms the reservation."],
      ["Support", `For changes or booking support, contact ${SITE.phone} or ${SITE.email}.`]
    ]
  }
};

// "/faq" → the FAQ page's content.
export const sitePageFor = (pathname = "") =>
  Object.values(SITE_PAGES).find((page) => page.path === String(pathname).replace(/\/+$/, "")) || null;

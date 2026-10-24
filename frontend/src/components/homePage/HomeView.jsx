import { SiteHeader, UtilityBar } from "./SiteChrome";
import { Hero, HeroSearchCard } from "./Hero";
import { BestSellers, CategoryTiles, CtaBand, FeaturedTours, ReviewsSection, SafariBanner, StepsStrip } from "./HomeSections";
import WhatsAppFab from "./WhatsAppFab";

export const HOME_TITLE = "Zanzibar Tours, Safaris & Airport Transfers | Riser Tours & Safaris";
export const HOME_DESCRIPTION =
  "Book Zanzibar tours, fly-in safaris and airport transfers with a local team: Mnemba snorkeling, Stone Town, spice farms and private trips. Instant confirmation, card, M-Pesa or PayPal.";

// The whole home page. The build renders it to HTML with the same data (scripts/prerender-public-pages.mjs).
const HomeView = ({ home = null }) => (
  <div className="hp">
    <UtilityBar />
    <SiteHeader />
    <div className="hp-main">
      <Hero />
      <HeroSearchCard />
      <CategoryTiles styles={home?.styles} />
      <FeaturedTours tours={home?.featured} />
      <SafariBanner safari={home?.safari} />
      <BestSellers tours={home?.bestSellers} />
      <StepsStrip />
      <ReviewsSection reviews={home?.reviews} />
      <CtaBand />
    </div>
    <WhatsAppFab />
  </div>
);

// The travel agency itself; a rating only when real reviews exist.
export const homeSchemas = (home, brand) => {
  const agency = {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    "@id": `${brand.website}/#travelagency`,
    name: brand.name,
    url: `${brand.website}/`,
    image: `${brand.website}/images/home/hero-dhow-1280.jpg`,
    telephone: brand.phone,
    email: brand.email,
    address: { "@type": "PostalAddress", addressLocality: "Zanzibar", addressCountry: "TZ" },
    areaServed: ["Zanzibar", "Tanzania"],
    parentOrganization: { "@id": `${brand.website}/#organization` }
  };
  const sameAs = Object.values(brand.social || {}).filter(Boolean);
  if (sameAs.length) agency.sameAs = sameAs;
  if (home?.reviews?.count && home.reviews.rating) {
    agency.aggregateRating = { "@type": "AggregateRating", ratingValue: home.reviews.rating, reviewCount: home.reviews.count, bestRating: 5 };
  }
  return [agency];
};

// The build writes the home data into the page (script#riser-prerender-home), so a visit shows it at once.
export const readPrerenderedHome = () => {
  if (typeof document === "undefined") return null;
  try {
    const node = document.getElementById("riser-prerender-home");
    return node ? JSON.parse(node.textContent || "null") : null;
  } catch {
    return null;
  }
};

export default HomeView;

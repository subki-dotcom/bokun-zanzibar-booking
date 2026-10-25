import { Hero, HeroSearchCard } from "./Hero";
import { BestSellers, CategoryTiles, FeaturedTours, ReviewsSection, SafariBanner, StepsStrip } from "./HomeSections";
import WhatsAppFab from "./WhatsAppFab";
import { travelAgencySchema } from "../../config/site";

export const HOME_TITLE = "Zanzibar Tours, Safaris & Airport Transfers | Riser Tours & Safaris";
export const HOME_DESCRIPTION =
  "Book Zanzibar tours, safaris and airport transfers with a local team: Mnemba snorkeling, Stone Town, spice farms. Instant confirmation, card or M-Pesa.";

// The whole home page below the site header (the layout draws that header over the hero). The build renders it to
// HTML with the same data (scripts/prerender-public-pages.mjs).
const HomeView = ({ home = null }) => (
  <div className="hp">
    <div className="hp-main">
      <Hero />
      <HeroSearchCard />
      <CategoryTiles styles={home?.styles} />
      <FeaturedTours tours={home?.featured} />
      <SafariBanner safari={home?.safari} />
      <BestSellers tours={home?.bestSellers} />
      <StepsStrip />
      <ReviewsSection reviews={home?.reviews} />
    </div>
    <WhatsAppFab />
  </div>
);

// The travel agency itself (as on every page); a rating only when real reviews exist.
export const homeSchemas = (home) => [travelAgencySchema(home?.reviews)];

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

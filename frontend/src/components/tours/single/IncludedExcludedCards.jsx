import IncludedExcludedSection from "./IncludedExcludedSection";
import { excludedForTour } from "./tourDisplayText";

const IncludedExcludedCards = ({ included = [], excluded = [], hasPickup = false }) => (
  <IncludedExcludedSection included={included} excluded={excludedForTour(excluded, hasPickup)} />
);

export default IncludedExcludedCards;


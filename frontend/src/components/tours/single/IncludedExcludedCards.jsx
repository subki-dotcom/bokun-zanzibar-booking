import IncludedExcludedSection from "./IncludedExcludedSection";

const IncludedExcludedCards = ({ included = [], excluded = [] }) => (
  <IncludedExcludedSection included={included} excluded={excluded} />
);

export default IncludedExcludedCards;


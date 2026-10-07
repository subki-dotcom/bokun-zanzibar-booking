// Live preview amounts are totals for comparedAdults; group prices are never divided.
export const pricePresentation = ({ amount = 0, pricingType = "", maxPerBooking, comparedAdults, isTotal = false } = {}) => {
  const group = pricingType === "per_group";
  const person = pricingType === "per_person";
  const count = Number(comparedAdults);
  return {
    amount: person && isTotal && count > 0 ? Number(amount) / count : Number(amount),
    label: group
      ? `per group${Number(maxPerBooking) > 0 ? ` up to ${Number(maxPerBooking)}` : ""}`
      : person && (!isTotal || count > 0) ? "per person" : isTotal ? "total" : ""
  };
};

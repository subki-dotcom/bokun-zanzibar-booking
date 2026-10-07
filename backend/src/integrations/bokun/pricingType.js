const ratePricingMetadata = (rate = {}, price = {}) => ({
  pricingType: Number(price?.pricePerBooking?.amount?.amount ?? price?.pricePerBooking?.amount ?? price?.pricePerBooking) > 0 || rate?.pricedPerPerson === false
    ? "per_group"
    : rate?.pricedPerPerson === true ? "per_person" : "",
  maxPerBooking: Number(rate?.maxPerBooking) > 0 ? Number(rate.maxPerBooking) : null
});

module.exports = { ratePricingMetadata };

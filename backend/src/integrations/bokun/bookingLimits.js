const requestedParticipantCount = (payload = {}) => {
  const participants = payload.priceCategoryParticipants;
  const categoryTotal = Array.isArray(participants)
    ? participants.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0)
    : 0;
  const pax = payload.pax || {};
  const paxTotal = [pax.adults, pax.children, pax.infants]
    .reduce((sum, quantity) => sum + Math.max(0, Number(quantity || 0)), 0);
  return categoryTotal || Math.max(1, paxTotal);
};

const exceedsRateLimits = (rate = {}, count = 1) => {
  const min = Number(rate?.minPerBooking || 0);
  const max = Number(rate?.maxPerBooking || 0);
  return (min > 0 && count < min) || (max > 0 && count > max);
};

module.exports = { requestedParticipantCount, exceedsRateLimits };

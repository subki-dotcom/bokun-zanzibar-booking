const dayjs = require("dayjs");
const cancellationPolicy = require("../cancellations/policy");

const getTravelStart = (booking = {}) => {
  const travelStart = cancellationPolicy.getTravelStartDate(booking, { fallbackEndOfDay: true });
  return travelStart ? dayjs(travelStart) : null;
};

module.exports = {
  ...cancellationPolicy,
  getTravelStart
};

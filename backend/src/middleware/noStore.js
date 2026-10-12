// Private customer data must not be kept by browsers, proxies or CDNs.
const noStore = (_req, res, next) => {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  res.vary("Authorization");
  res.vary("X-Booking-Access-Token");
  return next();
};

module.exports = noStore;

import { saveBookingSession } from "../../../utils/bookingSession";

// Opens checkout for a chosen option, date, start time and travellers: saves the booking session and navigates with
// the same query the checkout reads (option, date, catalog, passengers, time, adults). Returns false when something
// required is missing.
export const startTourCheckout = ({
  tour = {},
  navigate,
  option = null,
  travelDate = "",
  rateId = "",
  startTime = "",
  startTimeSlot = null,
  passengers = [],
  pax = { adults: 0, children: 0, infants: 0 },
  quote = null,
  checkoutPath = "",
  sessionSource = "single_product_page"
}) => {
  const optionId = String(option?.bokunOptionId || "").trim();
  const resolvedDate = String(travelDate || "").trim();
  const resolvedRateId = String(rateId || "").trim();
  const resolvedStartTime = String(startTime || "").trim();
  const normalizedPassengers = (passengers || [])
    .map((row = {}) => ({
      pricingCategoryId: String(row.pricingCategoryId || "").trim(),
      quantity: Math.max(0, Number(row.quantity || 0))
    }))
    .filter((row) => row.pricingCategoryId && row.quantity > 0);

  if (!optionId || !resolvedDate || !resolvedRateId || !resolvedStartTime || !normalizedPassengers.length) {
    return false;
  }

  const selectedCatalog =
    (tour.priceCatalogs || []).find((catalog = {}) => {
      const catalogId = String(catalog.activityPriceCatalogId || catalog.catalogId || catalog.id || "").trim();
      return catalogId === resolvedRateId;
    }) || null;

  saveBookingSession({
    source: sessionSource,
    product: {
      productId: String(tour.bokunProductId || ""),
      slug: tour.slug,
      title: tour.title
    },
    tripDetails: {
      optionId,
      optionTitle: option?.name || "",
      rateId: resolvedRateId,
      rateTitle: selectedCatalog?.title || selectedCatalog?.label || "",
      travelDate: resolvedDate,
      startTime: resolvedStartTime,
      startTimeId: String(startTimeSlot?.startTimeId || "").trim(),
      startTimeSlot,
      passengers: normalizedPassengers,
      pax
    },
    availabilityQuote: quote || null,
    currency: quote?.currency || tour.currency || "USD",
    tripDetailsCompleted: true,
    availabilityChecked: true
  });

  const query = new URLSearchParams();
  query.set("option", optionId);
  query.set("date", resolvedDate);
  query.set("catalog", resolvedRateId);
  query.set("passengers", JSON.stringify(normalizedPassengers));
  query.set("time", resolvedStartTime);
  if (Number(pax?.adults || 0) > 0) {
    query.set("adults", String(pax.adults));
  }

  navigate(`${checkoutPath || `/booking/${tour.slug}`}?${query.toString()}`);
  return true;
};

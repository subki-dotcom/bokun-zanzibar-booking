// Pure helpers for the staff booking form. Prices are never computed here.

export const quoteRequestFor = (form) => {
  const adults = Number(form.adults);
  const children = Number(form.children);
  const infants = Number(form.infants);
  const whole = (value) => Number.isInteger(value) && value >= 0;
  if (!form.pickupLocationId || !form.dropoffLocationId || form.pickupLocationId === form.dropoffLocationId) return null;
  if (!whole(adults) || adults < 1 || !whole(children) || !whole(infants)) return null;
  return { tripType: form.tripType, pickupLocationId: form.pickupLocationId, dropoffLocationId: form.dropoffLocationId, passengers: { adults, children, infants } };
};

// expectedTotal is the price the staff member saw; the server refuses the booking if its own price differs.
export const buildManualBooking = (form, quote, { allowDuplicate = false, duplicateReason = "" } = {}) => ({
  manualChannel: form.manualChannel,
  tripType: form.tripType,
  pickupLocationId: form.pickupLocationId,
  dropoffLocationId: form.dropoffLocationId,
  travelDate: form.travelDate,
  travelTime: form.travelTime,
  ...(form.tripType === "ROUND_TRIP" ? { returnDate: form.returnDate, returnTime: form.returnTime } : {}),
  passengers: { adults: Number(form.adults), children: Number(form.children) || 0, infants: Number(form.infants) || 0 },
  luggage: { largeBags: Number(form.largeBags) || 0, smallBags: Number(form.smallBags) || 0, notes: form.luggageNotes.trim() },
  flightNumber: form.flightNumber.trim(),
  pickupAddress: form.pickupAddress.trim(),
  dropoffAddress: form.dropoffAddress.trim(),
  customer: { fullName: form.fullName.trim(), email: form.email.trim(), phone: form.phone.trim(), whatsapp: Boolean(form.whatsapp) },
  specialRequests: form.specialRequests.trim(),
  expectedTotal: quote?.status === "PRICED" ? quote.total : null,
  ...(allowDuplicate ? { allowDuplicate: true, duplicateReason: duplicateReason.trim() } : {})
});

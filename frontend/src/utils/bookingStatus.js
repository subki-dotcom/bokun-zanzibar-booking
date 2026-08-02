const normalize = (value = "") => String(value || "").trim().toLowerCase();

export const isSupplierConfirmationPending = (booking = {}) => {
  if (normalize(booking.paymentStatus) !== "paid") return false;

  const bookingStatus = normalize(booking.bookingStatus);
  const supplierStatus = normalize(booking.supplierStatus);
  if (bookingStatus === "confirmed" || supplierStatus === "confirmed") return false;
  if (["cancelled", "failed", "reversed"].includes(bookingStatus)) return false;

  return Boolean(
    booking.pendingCheckout?.finalizationPending ||
      !String(booking.confirmationCode || "").trim() ||
      ["awaiting_payment", "supplier_pending"].includes(supplierStatus)
  );
};

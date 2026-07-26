const STORAGE_PREFIX = "riser_pesapal_checkout:";

const asText = (value = "") => String(value || "").trim();

const resolveCheckoutKey = (result = {}) =>
  asText(result.orderTrackingId) ||
  asText(result.merchantReference || result.orderMerchantReference) ||
  asText(result.bookingReference || result.bookingId) ||
  `${Date.now()}`;

export const storePesapalProcessingState = ({
  checkoutKey = "",
  redirectUrl = "",
  orderTrackingId = "",
  orderMerchantReference = "",
  bookingReference = ""
} = {}) => {
  const resolvedCheckoutKey =
    asText(checkoutKey) ||
    asText(orderTrackingId) ||
    asText(orderMerchantReference) ||
    asText(bookingReference) ||
    `${Date.now()}`;

  try {
    window.sessionStorage.setItem(
      `${STORAGE_PREFIX}${resolvedCheckoutKey}`,
      JSON.stringify({
        redirectUrl: asText(redirectUrl),
        orderTrackingId: asText(orderTrackingId),
        orderMerchantReference: asText(orderMerchantReference),
        bookingReference: asText(bookingReference),
        savedAt: new Date().toISOString()
      })
    );
  } catch (error) {
    return resolvedCheckoutKey;
  }

  return resolvedCheckoutKey;
};

export const buildPesapalProcessingPath = (result = {}) => {
  const checkoutKey = resolveCheckoutKey(result);
  const orderTrackingId = asText(result.orderTrackingId);
  const orderMerchantReference = asText(result.merchantReference || result.orderMerchantReference);
  const bookingReference = asText(result.bookingReference);
  const redirectUrl = asText(result.redirectUrl);
  const params = new URLSearchParams();

  if (checkoutKey) {
    params.set("checkoutKey", checkoutKey);
  }
  if (bookingReference) {
    params.set("bookingReference", bookingReference);
  }

  storePesapalProcessingState({
    checkoutKey,
    redirectUrl,
    orderTrackingId,
    orderMerchantReference,
    bookingReference
  });

  return `/payment-processing?${params.toString()}`;
};

export const readPesapalProcessingState = (searchParams) => {
  const checkoutKey = asText(searchParams.get("checkoutKey"));
  let stored = {};

  if (checkoutKey) {
    try {
      stored = JSON.parse(window.sessionStorage.getItem(`${STORAGE_PREFIX}${checkoutKey}`) || "{}");
    } catch (error) {
      stored = {};
    }
  }

  return {
    checkoutKey,
    redirectUrl: asText(stored.redirectUrl || searchParams.get("redirectUrl")),
    orderTrackingId: asText(
      searchParams.get("OrderTrackingId") ||
        searchParams.get("orderTrackingId") ||
        stored.orderTrackingId
    ),
    orderMerchantReference: asText(
      searchParams.get("OrderMerchantReference") ||
        searchParams.get("orderMerchantReference") ||
        stored.orderMerchantReference
    ),
    bookingReference: asText(searchParams.get("bookingReference") || stored.bookingReference)
  };
};

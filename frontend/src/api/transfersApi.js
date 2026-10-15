import axiosClient from "./axiosClient";

// Transfer System public API. Independent of the tour (Bókun) booking endpoints.
export const fetchTransferLocations = async () => (await axiosClient.get("/transfers/locations")).data.data;

// Popular routes shown under the booking widget, each with its starting price from the server.
export const fetchPopularRoutes = async () => (await axiosClient.get("/transfers/popular-routes")).data.data;

// Booking horizon and the payment methods customers can use.
export const fetchTransferOptions = async () => (await axiosClient.get("/transfers/options")).data.data;

export const fetchTransferQuote = async (request) => (await axiosClient.post("/transfers/quote", request)).data.data;

export const createTransferBooking = async (payload, idempotencyKey) =>
  (await axiosClient.post("/transfers/bookings", payload, { headers: { "Idempotency-Key": idempotencyKey } })).data.data;

export const fetchTransferBooking = async (reference, accessToken) =>
  (await axiosClient.get(`/transfers/bookings/${encodeURIComponent(reference)}`, { headers: { "X-Transfer-Access-Token": accessToken } })).data.data;

// Opens a Pesapal checkout for the booking's server price; answers with the Pesapal page to send the customer to.
export const startTransferPayment = async (reference, accessToken) =>
  (await axiosClient.post(`/transfers/bookings/${encodeURIComponent(reference)}/payments`, {}, { headers: { "X-Transfer-Access-Token": accessToken } })).data.data;

// After Pesapal sends the customer back: the server asks Pesapal for the transaction and reports what it found.
export const verifyTransferPayment = async ({ orderTrackingId, merchantReference }) =>
  (await axiosClient.get("/transfers/payments/return", { params: { OrderTrackingId: orderTrackingId, OrderMerchantReference: merchantReference || undefined } })).data.data;

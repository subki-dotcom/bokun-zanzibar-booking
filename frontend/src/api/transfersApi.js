import axiosClient from "./axiosClient";

// Transfer System public API. Independent of the tour (Bókun) booking endpoints.
export const fetchTransferLocations = async () => (await axiosClient.get("/transfers/locations")).data.data;

export const fetchTransferQuote = async (request) => (await axiosClient.post("/transfers/quote", request)).data.data;

export const createTransferBooking = async (payload, idempotencyKey) =>
  (await axiosClient.post("/transfers/bookings", payload, { headers: { "Idempotency-Key": idempotencyKey } })).data.data;

export const fetchTransferBooking = async (reference, accessToken) =>
  (await axiosClient.get(`/transfers/bookings/${encodeURIComponent(reference)}`, { headers: { "X-Transfer-Access-Token": accessToken } })).data.data;

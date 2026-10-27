// Guest "My booking" API. Same-origin (/api) with the httpOnly session cookie; changes send the session's CSRF
// token and an idempotency key. Errors are normalised like the rest of the site.
import axios from "axios";
import { MY_BOOKING_API_BASE_URL } from "../config/api";
import { customerFacingMessage } from "./axiosClient";

const client = axios.create({ baseURL: MY_BOOKING_API_BASE_URL, timeout: 30000, withCredentials: true });

let csrfToken = "";
export const setCsrfToken = (value = "") => {
  csrfToken = value;
};

client.interceptors.request.use((config) => {
  if (csrfToken && config.method && config.method.toLowerCase() !== "get") config.headers["X-CSRF-Token"] = csrfToken;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) =>
    Promise.reject({
      status: error.response?.status || 0,
      code: error.response?.data?.error?.code || (error.response ? "CLIENT_ERROR" : "NETWORK_ERROR"),
      network: !error.response,
      message: customerFacingMessage(
        error.response?.data?.message ||
          (!error.response ? "We couldn't reach our server. Please check your connection and try again." : "Something went wrong. Please try again.")
      )
    })
);

const data = (response) => response.data.data;
const bookingPath = (reference) => `/my-booking/bookings/${encodeURIComponent(reference)}`;

export const requestBookingLink = (payload) => client.post("/my-booking/lookup", payload).then((response) => response.data);
export const openBookingLink = (token) => client.post("/my-booking/session", { token }).then(data);
export const openWithPaymentKey = (reference, key) => client.post("/my-booking/session/payment-key", { reference, key }).then(data);
export const fetchBookingSession = () => client.get("/my-booking/session").then(data);
export const signOutOfBooking = () => client.post("/my-booking/session/sign-out", {}).then(data);
export const fetchMyBooking = (reference) => client.get(bookingPath(reference)).then(data);
export const fetchMyBookingInvoice = (reference) => client.get(`${bookingPath(reference)}/invoice`).then(data);
export const fetchCancellationEstimate = (reference) => client.get(`${bookingPath(reference)}/cancellation-estimate`).then(data);
export const submitMyBookingRequest = (reference, payload, idempotencyKey) =>
  client.post(`${bookingPath(reference)}/requests`, payload, { headers: { "Idempotency-Key": idempotencyKey } }).then(data);
export const sendContactCode = (reference) => client.post(`${bookingPath(reference)}/contact/code`, {}).then((response) => response.data);
export const revealContact = (reference, code) => client.post(`${bookingPath(reference)}/contact/reveal`, { code }).then(data);

// Files are fetched with the cookie (same origin), so plain links work.
export const ticketPdfUrl = (reference) => `${MY_BOOKING_API_BASE_URL}${bookingPath(reference)}/ticket.pdf`;
export const ticketQrUrl = (reference) => `${MY_BOOKING_API_BASE_URL}${bookingPath(reference)}/ticket-qr.svg`;

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`;

// Invoice PDF: a 10-minute signed link (same origin, needs this session), and "Email me a copy".
export const requestInvoicePdfLink = (reference, number = "") =>
  client.post(`${bookingPath(reference)}/invoice/pdf-link`, { number }).then(data);
export const emailInvoiceCopy = (reference) => client.post(`${bookingPath(reference)}/invoice/email`, {}).then((response) => response.data);

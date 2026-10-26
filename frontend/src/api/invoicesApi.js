import axiosClient from "./axiosClient";

export const fetchInvoiceByNumber = async (invoiceNumber) => {
  const response = await axiosClient.get(`/invoices/${encodeURIComponent(invoiceNumber)}`);
  return response.data.data;
};

// Needs the payment link key (or a staff login); guests signed in to "My booking" use fetchMyBookingInvoice.
export const fetchInvoiceByBookingReference = async (bookingReference, { key = "" } = {}) => {
  const response = await axiosClient.get(`/invoices/booking/${encodeURIComponent(bookingReference)}`, { params: key ? { key } : {} });
  return response.data.data;
};

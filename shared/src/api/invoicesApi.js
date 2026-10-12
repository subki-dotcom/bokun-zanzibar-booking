import axiosClient from "./axiosClient";
import { getWithBookingAccess } from "./bookingsApi";

export const fetchInvoiceByNumber = async (invoiceNumber) => {
  const response = await axiosClient.get(`/invoices/${encodeURIComponent(invoiceNumber)}`);
  return response.data.data;
};

export const fetchInvoiceByBookingReference = async (bookingReference) => {
  const response = await getWithBookingAccess(`/invoices/booking/${encodeURIComponent(bookingReference)}`, bookingReference);
  return response.data.data;
};

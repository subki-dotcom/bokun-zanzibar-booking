import axiosClient from "./axiosClient";

export const fetchInvoiceByBookingReference = async (bookingReference) => {
  const response = await axiosClient.get(`/invoices/booking/${bookingReference}`);
  return response.data.data;
};
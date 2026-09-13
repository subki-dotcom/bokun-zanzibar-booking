import axiosClient from "./axiosClient";

export const fetchInvoiceByNumber = async (invoiceNumber) => {
  const response = await axiosClient.get(`/invoices/${encodeURIComponent(invoiceNumber)}`);
  return response.data.data;
};

export const fetchInvoiceByBookingReference = async (bookingReference) => {
  const response = await axiosClient.get(`/invoices/booking/${bookingReference}`);
  return response.data.data;
};

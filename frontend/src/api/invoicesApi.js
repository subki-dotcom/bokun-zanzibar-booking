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

// Staff: any invoice or credit note as the customer document, and its PDF.
export const fetchInvoiceDocument = async (invoiceNumber) => {
  const response = await axiosClient.get(`/invoices/${encodeURIComponent(invoiceNumber)}/document`);
  return response.data.data;
};

export const fetchInvoicePdfBlob = async (invoiceNumber, documentNumber = "") => {
  const response = await axiosClient.get(`/invoices/${encodeURIComponent(invoiceNumber)}/pdf`, {
    params: documentNumber ? { document: documentNumber } : {},
    responseType: "blob"
  });
  return response.data;
};

// Public "Scan to verify": no personal data.
export const fetchInvoiceVerification = async (token) => {
  const response = await axiosClient.get(`/invoices/verify/${encodeURIComponent(token)}`);
  return response.data.data;
};

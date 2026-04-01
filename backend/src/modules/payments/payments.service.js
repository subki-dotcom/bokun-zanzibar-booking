const { v4: uuidv4 } = require("uuid");
const Payment = require("../../models/Payment");

const createPaymentIntent = async ({
  bookingReference,
  customerId,
  amount,
  currency,
  provider = "custom",
  notes = ""
}) => {
  return Payment.create({
    bookingReference,
    customerId,
    amount,
    currency,
    provider,
    intentId: `pay_${uuidv4()}`,
    status: "pending",
    notes,
    providerResponse: {
      abstraction: "Payment provider integration placeholder",
      nextProviders: ["pesapal", "stripe", "manual_bank", "cash_on_arrival"]
    }
  });
};

const updatePaymentStatus = async ({ intentId, status, paidAmount = 0, refundedAmount = 0, providerResponse = {} }) => {
  return Payment.findOneAndUpdate(
    { intentId },
    {
      $set: {
        status,
        paidAmount,
        refundedAmount,
        providerResponse
      }
    },
    { new: true }
  );
};

const findLatestPaymentByBookingReference = async ({ bookingReference, provider = "" }) => {
  const query = {
    bookingReference: String(bookingReference || "")
  };

  if (provider) {
    query.provider = String(provider || "");
  }

  return Payment.findOne(query).sort({ createdAt: -1 });
};

const updatePaymentByBookingReference = async ({
  bookingReference,
  provider = "",
  status,
  paidAmount = 0,
  refundedAmount = 0,
  providerResponse = {},
  notes = ""
}) => {
  const query = {
    bookingReference: String(bookingReference || "")
  };

  if (provider) {
    query.provider = String(provider || "");
  }

  return Payment.findOneAndUpdate(
    query,
    {
      $set: {
        status,
        paidAmount,
        refundedAmount,
        providerResponse,
        ...(notes ? { notes } : {})
      }
    },
    { new: true, sort: { createdAt: -1 } }
  );
};

const listPayments = async () => {
  return Payment.find({}).sort({ createdAt: -1 }).lean();
};

module.exports = {
  createPaymentIntent,
  updatePaymentStatus,
  findLatestPaymentByBookingReference,
  updatePaymentByBookingReference,
  listPayments
};

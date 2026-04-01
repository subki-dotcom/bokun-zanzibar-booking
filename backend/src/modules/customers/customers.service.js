const Customer = require("../../models/Customer");
const AppError = require("../../utils/AppError");

const listCustomers = async () => {
  return Customer.find({}).sort({ createdAt: -1 }).lean();
};

const getCustomer = async (id) => {
  const customer = await Customer.findById(id).populate("bookings").lean();

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return customer;
};

module.exports = {
  listCustomers,
  getCustomer
};
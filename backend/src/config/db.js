const mongoose = require("mongoose");
const { env } = require("./env");
const logger = require("./logger");
const Booking = require("../models/Booking");

const connectDB = async () => {
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(env.MONGO_URI);
    await Booking.createIndexes();
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error("MongoDB connection failed", { error: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;

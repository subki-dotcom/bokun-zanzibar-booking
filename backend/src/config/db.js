const mongoose = require("mongoose");
const { env } = require("./env");
const logger = require("./logger");
const Booking = require("../models/Booking");
const RevenueRecognition = require("../models/RevenueRecognition");
const JournalEntry = require("../models/JournalEntry");

const connectDB = async () => {
  mongoose.set("strictQuery", true);

  try {
    // Built-in wire compression reduces outbound sync payloads without changing
    // queries or stored data. The driver negotiates support with MongoDB.
    await mongoose.connect(env.MONGO_URI, { compressors: ["zlib"], zlibCompressionLevel: 3 });
    await Booking.createIndexes();
    await RevenueRecognition.createIndexes();
    await JournalEntry.createIndexes();
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error("MongoDB connection failed", { error: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;

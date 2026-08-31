const path = require('path');

async function findDuplicateKeys({ BookingModel, key }) {
  if (!BookingModel) {
    try {
      BookingModel = require('../models/Booking');
    } catch (e) {
      BookingModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Booking'));
    }
  }
  const pipeline = [
    { $match: { [key]: { $exists: true, $ne: "" } } },
    { $group: { _id: `$${key}`, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ];
  try {
    // mongoose aggregation cursor-aware path
    const res = await BookingModel.aggregate(pipeline).allowDiskUse(true).exec();
    return res;
  } catch (e) {
    // fallback for mocked BookingModel.aggregate() that returns a promise/array
    const res = await BookingModel.aggregate(pipeline);
    return res;
  }
}

async function createUniqueSparseIndex({ BookingModel, key, indexName }) {
  if (!BookingModel) {
    try {
      BookingModel = require('../models/Booking');
    } catch (e) {
      BookingModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Booking'));
    }
  }
  indexName = indexName || `unique_${key}`;
  const spec = { [key]: 1 };
  const opts = { unique: true, sparse: true, name: indexName };
  return BookingModel.collection.createIndex(spec, opts);
}

module.exports = {
  findDuplicateKeys,
  createUniqueSparseIndex
};

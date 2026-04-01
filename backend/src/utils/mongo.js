const mongoose = require("mongoose");

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

module.exports = {
  toObjectId
};
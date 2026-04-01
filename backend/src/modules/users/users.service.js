const User = require("../../models/User");

const listUsers = async () => {
  return User.find({}).select("-password").sort({ createdAt: -1 }).lean();
};

module.exports = {
  listUsers
};
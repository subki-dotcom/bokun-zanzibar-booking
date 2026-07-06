const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const usersService = require("../services/users");

const listUsers = asyncHandler(async (_req, res) => {
  const users = await usersService.listUsers();

  return successResponse(res, {
    message: "Users fetched",
    data: users
  });
});

module.exports = {
  listUsers
};
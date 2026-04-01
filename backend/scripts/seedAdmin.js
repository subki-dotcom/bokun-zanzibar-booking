require("dotenv").config();

const connectDB = require("../src/config/db");
const logger = require("../src/config/logger");
const authService = require("../src/modules/auth/auth.service");

const run = async () => {
  await connectDB();

  const user = await authService.registerAdmin(
    {
      firstName: process.env.SEED_ADMIN_FIRST_NAME || "Super",
      lastName: process.env.SEED_ADMIN_LAST_NAME || "Admin",
      email: process.env.SEED_ADMIN_EMAIL || "admin@zanzibartours.com",
      password: process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
      role: "super_admin"
    },
    null
  );

  logger.info("Seed admin created", { email: user.email, role: user.role });
  process.exit(0);
};

run().catch((error) => {
  logger.error("Failed to seed admin", { message: error.message });
  process.exit(1);
});
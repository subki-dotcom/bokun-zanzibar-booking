// Creates the first Transfer Admin user (role transfer_admin) in the Transfer System database. There is no
// default password: it is read from the environment for this run and checked against the password policy.
//
//   TRANSFER_ADMIN_NAME="Jane Doe" TRANSFER_ADMIN_EMAIL=jane@example.com TRANSFER_ADMIN_PASSWORD=... \
//   npm run transfers:create-admin
//
// It refuses once any Transfer Admin user exists; further users are added from the Transfer Admin.
require("dotenv").config();
const { configurationProblems } = require("../../src/transfers/config");
const { env } = require("../../src/config/env");
const { connectTransferDatabase, setTransferStore, closeTransferStore } = require("../../src/transfers/db/connection");
const { createTransferServices } = require("../../src/transfers");
const { passwordSchema } = require("../../src/transfers/security/password");

const main = async () => {
  const problems = configurationProblems(env);
  if (problems.length) throw new Error(`Transfer System is not configured: ${problems.join("; ")}`);
  const name = String(process.env.TRANSFER_ADMIN_NAME || "").trim();
  const email = String(process.env.TRANSFER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.TRANSFER_ADMIN_PASSWORD || "";
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("TRANSFER_ADMIN_NAME and a valid TRANSFER_ADMIN_EMAIL are required.");
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(`TRANSFER_ADMIN_PASSWORD: ${check.error.issues.map((issue) => issue.message).join("; ")}`);

  setTransferStore(await connectTransferDatabase());
  const user = await createTransferServices().auth.createFirstAdmin({ name, email, password });
  console.log(`Created ${user.role} ${user.email}.`);
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeTransferStore());

const bcrypt = require("bcryptjs");
const { z } = require("zod");

const BCRYPT_ROUNDS = 12;

// bcrypt reads at most 72 bytes; longer passwords are rejected rather than silently truncated.
const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long")
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), "Password needs upper case, lower case and a number");

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

// Compared against when the email is unknown, so a missing account takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("transfer-admin-timing-equaliser", BCRYPT_ROUNDS);

const verifyPassword = (password, hash) => bcrypt.compare(String(password || ""), hash || DUMMY_HASH);

module.exports = { passwordSchema, hashPassword, verifyPassword };

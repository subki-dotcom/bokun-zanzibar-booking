const { z } = require("zod");

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    portal: z.enum(["admin", "agent"]).default("admin")
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional()
});

const registerAdminSchema = z.object({
  body: z.object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["super_admin", "admin", "staff"]).optional()
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional()
});

module.exports = {
  loginSchema,
  registerAdminSchema
};
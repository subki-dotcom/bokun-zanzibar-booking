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

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8, "The new password needs at least 8 characters.").max(128)
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

const registerAgentSchema = z.object({
  body: z.object({
    companyName: z.string().min(2),
    contactFirstName: z.string().min(2),
    contactLastName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().min(6).optional(),
    country: z.string().optional(),
    address: z.string().optional(),
    agentType: z.enum(["hotel", "freelancer", "tour_agent", "partner", "other"]).default("partner"),
    notes: z.string().optional()
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional()
});

module.exports = {
  changePasswordSchema,
  loginSchema,
  registerAdminSchema,
  registerAgentSchema
};

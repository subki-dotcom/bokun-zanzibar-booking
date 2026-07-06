const { z } = require("zod");

const createAgentSchema = z.object({
  body: z.object({
    companyName: z.string().min(2),
    contactFirstName: z.string().min(2),
    contactLastName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().optional(),
    country: z.string().optional(),
    commissionPercent: z.number().min(0).max(100).optional(),
    productCommissionOverrides: z
      .array(
        z.object({
          bokunProductId: z.string(),
          percent: z.number().min(0).max(100)
        })
      )
      .optional(),
    optionCommissionOverrides: z
      .array(
        z.object({
          bokunOptionId: z.string(),
          percent: z.number().min(0).max(100)
        })
      )
      .optional(),
    notes: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const updateAgentProfileSchema = z.object({
  body: z.object({
    companyName: z.string().min(2).optional(),
    contactFirstName: z.string().min(2).optional(),
    contactLastName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    country: z.string().optional(),
    address: z.string().optional(),
    agentType: z.enum(["hotel", "freelancer", "tour_agent", "partner", "other"]).optional(),
    profilePhotoUrl: z.string().url().or(z.literal("")).optional(),
    currentPassword: z.string().min(8).optional(),
    newPassword: z.string().min(8).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const updatePayoutMethodSchema = z.object({
  body: z.object({
    payoutMethod: z.enum(["bank_transfer", "mobile_money", "cash", "paypal", "wise", "other"]),
    accountHolderName: z.string().min(2),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankBranch: z.string().optional(),
    mobileMoneyProvider: z.enum(["mpesa", "tigo_pesa", "airtel_money", "halopesa", "other"]).optional(),
    mobileMoneyNumber: z.string().optional(),
    paypalEmail: z.string().email().optional().or(z.literal("")),
    wiseEmail: z.string().email().optional().or(z.literal("")),
    payoutNotes: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const updateAgentSettingsSchema = z.object({
  body: z.object({
    language: z.enum(["English", "Swahili"]).default("English"),
    currency: z.enum(["USD", "TZS", "EUR", "GBP"]).default("USD"),
    emailNotifications: z.boolean().default(true),
    whatsappNotifications: z.boolean().default(true),
    bookingNotifications: z.boolean().default(true),
    cancellationNotifications: z.boolean().default(true),
    statementNotifications: z.boolean().default(true),
    statementFrequency: z.enum(["monthly", "weekly"]).default("monthly"),
    twoFactorEnabled: z.boolean().default(false)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const updateAgentStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean().optional(),
    approvalStatus: z.enum(["pending", "approved", "suspended"]).optional()
  }),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({}).optional()
});

const updateAgentCommissionSchema = z.object({
  body: z.object({
    commissionPercent: z.number().min(0).max(100)
  }),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({}).optional()
});

module.exports = {
  createAgentSchema,
  updateAgentProfileSchema,
  updatePayoutMethodSchema,
  updateAgentSettingsSchema,
  updateAgentStatusSchema,
  updateAgentCommissionSchema
};

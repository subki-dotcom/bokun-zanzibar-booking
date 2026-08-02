const { z } = require("zod");

const internationalPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone number must use international format, for example +255778775044");

const customerSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: internationalPhoneSchema,
  country: z.string().optional(),
  hotelName: z.string().optional(),
  pickupPlaceId: z.string().optional(),
  notes: z.string().optional()
});

module.exports = {
  customerSchema,
  internationalPhoneSchema
};

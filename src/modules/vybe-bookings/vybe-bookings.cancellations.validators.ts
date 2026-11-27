import { z } from "zod";

export const cancelMyVybeBookingSchema = z.object({
  params: z.object({ bookingId: z.string().uuid() }),
  query: z.object({}),
  body: z.object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(120)
      .regex(/^[\x21-\x7e]+$/),
    reason: z.string().trim().min(3).max(1000)
  })
});

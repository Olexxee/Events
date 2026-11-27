import { z } from "zod";

const uuid = z.string().uuid();

export const listMyVybeBookingsSchema = z.object({
  params: z.object({}),
  query: z.object({
    status: z
      .enum(["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: uuid.optional()
  }),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

export const getMyVybeBookingSchema = z.object({
  params: z.object({ bookingId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

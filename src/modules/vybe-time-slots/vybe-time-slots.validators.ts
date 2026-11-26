import { z } from "zod";

const uuid = z.string().uuid();

export const getVybeTimeSlotAvailabilitySchema = z.object({
  params: z.object({ occurrenceId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

export const createVybeTimeSlotCapacityHoldSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      occurrenceId: uuid,
      quantity: z.number().int().min(1).max(100000),
      idempotencyKey: z.string().trim().min(16).max(128)
    })
    .strict()
});

export const releaseVybeTimeSlotCapacityHoldSchema = z.object({
  params: z.object({ holdId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

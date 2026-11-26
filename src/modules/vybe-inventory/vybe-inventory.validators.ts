import { z } from "zod";

const uuid = z.string().uuid();
const positiveQuantity = z.number().int().min(1).max(100000);

export const createVybeInventoryPoolSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      organizationId: uuid,
      offeringId: uuid,
      allocatedQuantity: positiveQuantity,
      reason: z.string().trim().min(15).max(1000),
      evidenceReference: z.string().trim().min(5).max(1000)
    })
    .strict()
});

export const adjustVybeInventoryAllocationSchema = z.object({
  params: z.object({ poolId: uuid }),
  query: z.object({}),
  body: z
    .object({
      quantityDelta: z
        .number()
        .int()
        .min(-100000)
        .max(100000)
        .refine((value) => value !== 0),
      reason: z.string().trim().min(15).max(1000),
      evidenceReference: z.string().trim().min(5).max(1000)
    })
    .strict()
});

export const getVybeInventoryAvailabilitySchema = z.object({
  params: z.object({ offeringId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

export const createVybeInventoryHoldSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      offeringId: uuid,
      quantity: positiveQuantity,
      idempotencyKey: z.string().trim().min(16).max(128)
    })
    .strict()
});

export const releaseVybeInventoryHoldSchema = z.object({
  params: z.object({ holdId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

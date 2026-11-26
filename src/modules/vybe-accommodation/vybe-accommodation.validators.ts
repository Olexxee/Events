import { z } from "zod";

const uuid = z.string().uuid();
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Must be a valid calendar date");
const evidenceReference = z.string().trim().min(5).max(1000);
const reason = z.string().trim().min(10).max(1000);

const specifications = z
  .record(
    z.string().trim().min(1).max(80),
    z.union([
      z.string().trim().max(500),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().trim().min(1).max(120)).max(20)
    ])
  )
  .default({});

export const createAccommodationPropertySchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      organizationId: uuid,
      providerPropertyKey: z.string().trim().min(2).max(120),
      name: z.string().trim().min(2).max(180),
      addressLine: z.string().trim().max(300).optional(),
      city: z.string().trim().min(2).max(100),
      state: z.string().trim().min(2).max(100),
      country: z.string().trim().min(2).max(100),
      postalCode: z.string().trim().max(32).optional(),
      timezone: z.string().trim().min(3).max(80)
    })
    .strict()
});

export const createAccommodationRoomCategorySchema = z.object({
  params: z.object({ propertyId: uuid }),
  query: z.object({}),
  body: z
    .object({
      providerCategoryKey: z.string().trim().min(2).max(120),
      name: z.string().trim().min(2).max(160),
      description: z.string().trim().max(1000).optional(),
      maxOccupancy: z.number().int().min(1).max(30),
      physicalUnitCount: z.number().int().min(1).max(10000),
      physicalUnitCountEvidenceReference: evidenceReference,
      specifications,
      offeringId: uuid
    })
    .strict()
});

export const updateAccommodationCapacitySchema = z.object({
  params: z.object({ roomCategoryId: uuid }),
  query: z.object({}),
  body: z
    .object({
      physicalUnitCount: z.number().int().min(1).max(10000),
      evidenceReference,
      reason
    })
    .strict()
});

export const createAccommodationAllocationSchema = z.object({
  params: z.object({ roomCategoryId: uuid }),
  query: z.object({}),
  body: z
    .object({
      startDate: dateOnly,
      endDate: dateOnly,
      releaseCutoffLocal: z
        .string()
        .trim()
        .min(20)
        .max(40)
        .regex(
          /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([+-]([01]\d|2[0-3]):[0-5]\d|Z)$/,
          "Must include an explicit UTC offset"
        ),
      agreementReference: z.string().trim().min(5).max(500),
      evidenceReference,
      nights: z
        .array(
          z
            .object({
              stayDate: dateOnly,
              allocatedQuantity: z.number().int().min(1).max(10000)
            })
            .strict()
        )
        .min(1)
        .max(366)
    })
    .strict()
});

export const adjustAccommodationAllocationNightSchema = z.object({
  params: z.object({ allocationNightId: uuid }),
  query: z.object({}),
  body: z
    .object({
      quantityDelta: z
        .number()
        .int()
        .min(-10000)
        .max(10000)
        .refine((value) => value !== 0),
      reason,
      evidenceReference
    })
    .strict()
});

export const releaseAccommodationAllocationSchema = z.object({
  params: z.object({ allocationId: uuid }),
  query: z.object({}),
  body: z
    .object({
      reason,
      evidenceReference
    })
    .strict()
});

export type CreateAccommodationPropertyBody = z.infer<
  typeof createAccommodationPropertySchema
>["body"];
export type CreateAccommodationRoomCategoryBody = z.infer<
  typeof createAccommodationRoomCategorySchema
>["body"];
export type UpdateAccommodationCapacityBody = z.infer<
  typeof updateAccommodationCapacitySchema
>["body"];
export type CreateAccommodationAllocationBody = z.infer<
  typeof createAccommodationAllocationSchema
>["body"];
export type AdjustAccommodationAllocationNightBody = z.infer<
  typeof adjustAccommodationAllocationNightSchema
>["body"];
export type ReleaseAccommodationAllocationBody = z.infer<
  typeof releaseAccommodationAllocationSchema
>["body"];

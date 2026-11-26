import { z } from "zod";

const uuid = z.string().uuid();
const evidenceReference = z.string().trim().min(5).max(1000);
const isoWithOffset = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
    "A full ISO-8601 timestamp with an explicit UTC offset is required"
  );

const validityWindow = {
  validFrom: isoWithOffset.optional(),
  validUntil: isoWithOffset.optional()
};

export const createVybeTimeSlotOccurrenceSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      offeringId: uuid,
      inventoryMode: z.enum(["CAPACITY", "EXCLUSIVE"]),
      timezone: z.string().trim().min(1).max(80),
      serviceStartsAt: isoWithOffset,
      serviceEndsAt: isoWithOffset,
      preBufferSeconds: z.number().int().min(0).max(86400).default(0),
      postBufferSeconds: z.number().int().min(0).max(86400).default(0),
      capacity: z.number().int().min(1).max(100000).optional(),
      resourceGroupId: uuid.optional(),
      supplyEvidenceReference: evidenceReference
    })
    .strict()
    .superRefine((value, context) => {
      if (value.inventoryMode === "CAPACITY") {
        if (value.capacity === undefined) {
          context.addIssue({
            code: "custom",
            path: ["capacity"],
            message: "Capacity is required for CAPACITY occurrences"
          });
        }
        if (value.resourceGroupId !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["resourceGroupId"],
            message: "A resource group is not valid for CAPACITY occurrences"
          });
        }
      } else {
        if (value.capacity !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["capacity"],
            message: "Capacity is not valid for EXCLUSIVE occurrences"
          });
        }
        if (value.resourceGroupId === undefined) {
          context.addIssue({
            code: "custom",
            path: ["resourceGroupId"],
            message: "A resource group is required for EXCLUSIVE occurrences"
          });
        }
      }
    })
});

export const createVybeTimeSlotResourceGroupSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      offeringId: uuid,
      name: z.string().trim().min(2).max(120),
      ...validityWindow,
      supplyEvidenceReference: evidenceReference
    })
    .strict()
});

export const createVybeTimeSlotResourceSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z
    .object({
      offeringId: uuid,
      providerResourceKey: z.string().trim().min(2).max(120),
      name: z.string().trim().min(2).max(160),
      supplyEvidenceReference: evidenceReference
    })
    .strict()
});

export const addVybeTimeSlotResourceGroupMemberSchema = z.object({
  params: z.object({ groupId: uuid }),
  query: z.object({}),
  body: z
    .object({
      resourceId: uuid,
      ...validityWindow,
      supplyEvidenceReference: evidenceReference
    })
    .strict()
});

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


export const getVybeTimeSlotResourceAvailabilitySchema = z.object({
  params: z.object({ occurrenceId: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});

export const createVybeTimeSlotResourceHoldSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z.object({
    occurrenceId: uuid,
    idempotencyKey: z.string().trim().min(16).max(128)
  }).strict()
});

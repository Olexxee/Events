import { z } from "zod";

const uuidSchema = z.string().uuid();

export const submitOrganizerApplicationSchema = z.object({
  body: z.object({
    organizationId: uuidSchema,
    applicationMessage: z.string().trim().min(20).max(2000),
    websiteUrl: z.string().trim().url().max(500).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

export const decideOrganizerApplicationSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().min(10).max(1000)
  }),
  params: z.object({ id: uuidSchema }),
  query: z.object({})
});

import { z } from "zod";

const uuidSchema = z.string().uuid();
const categorySchema = z.enum([
  "ACCOMMODATION",
  "DINING",
  "DRINKS",
  "TABLES_LOUNGES",
  "VIP_EXPERIENCES",
  "OTHER_SERVICES"
]);

const locationSchema = z.object({
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100)
});

export const submitVybeProviderApplicationSchema = z.object({
  body: z.object({
    organizationId: uuidSchema,
    category: categorySchema,
    serviceDescription: z.string().trim().min(20).max(1500),
    supplyAuthorityStatement: z.string().trim().min(20).max(2000),
    supplyAuthorityAttested: z.literal(true),
    termsVersion: z.string().trim().min(1).max(40),
    locations: z.array(locationSchema).min(1).max(10),
    evidence: z.array(z.object({
      evidenceType: z.string().trim().min(2).max(100),
      requirementReason: z.string().trim().min(10).max(1000),
      storageReference: z.string().trim().min(5).max(1000)
    })).max(10).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

export const reviewVybeProviderApplicationSchema = z.object({
  body: z.object({
    decision: z.enum(["UNDER_REVIEW", "NEEDS_INFORMATION", "APPROVED", "REJECTED"]),
    reason: z.string().trim().min(10).max(1000),
    conditions: z.array(z.string().trim().min(2).max(500)).max(20).optional(),
    expiresAt: z.string().datetime().optional(),
    evidenceDecisions: z.array(z.object({
      evidenceId: uuidSchema,
      status: z.enum(["ACCEPTED", "REJECTED"]),
      reason: z.string().trim().min(10).max(1000)
    })).max(10).optional()
  }),
  params: z.object({ id: uuidSchema }),
  query: z.object({})
});

export const addVybeProviderEvidenceSchema = z.object({
  body: z.object({
    evidence: z.array(z.object({
      evidenceType: z.string().trim().min(2).max(100),
      requirementReason: z.string().trim().min(10).max(1000),
      storageReference: z.string().trim().min(5).max(1000)
    })).min(1).max(10)
  }),
  params: z.object({ id: uuidSchema }),
  query: z.object({})
});

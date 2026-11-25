import { z } from "zod";

const clockTime = z
  .string()
  .regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);

export const vybeCategoryAttributesSchema = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("ACCOMMODATION"),
    propertyType: z.enum([
      "HOTEL",
      "APARTMENT",
      "GUESTHOUSE",
      "HOSTEL",
      "VILLA"
    ]),
    roomCategory: z.string().trim().min(2).max(100),
    maxOccupancy: z.number().int().min(1).max(30),
    checkInTime: clockTime,
    checkOutTime: clockTime
  }).strict(),
  z.object({
    category: z.literal("DINING"),
    cuisine: z.string().trim().min(2).max(100),
    servicePeriods: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
    minPartySize: z.number().int().min(1).max(50),
    maxPartySize: z.number().int().min(1).max(100),
    reservationDurationMinutes: z.number().int().min(15).max(600)
  }).strict().refine(
    (value) => value.maxPartySize >= value.minPartySize,
    {
      path: ["maxPartySize"],
      message: "Maximum party size must be at least the minimum"
    }
  ),
  z.object({
    category: z.literal("DRINKS"),
    packageType: z.string().trim().min(2).max(100),
    quantity: z.number().int().min(1).max(10000),
    serviceWindow: z.string().trim().min(2).max(160),
    ageRestricted: z.boolean()
  }).strict(),
  z.object({
    category: z.literal("TABLES_LOUNGES"),
    resourceType: z.string().trim().min(2).max(100),
    minOccupancy: z.number().int().min(1).max(100),
    maxOccupancy: z.number().int().min(1).max(300),
    durationMinutes: z.number().int().min(15).max(1440)
  }).strict().refine(
    (value) => value.maxOccupancy >= value.minOccupancy,
    {
      path: ["maxOccupancy"],
      message: "Maximum occupancy must be at least the minimum"
    }
  ),
  z.object({
    category: z.literal("VIP_EXPERIENCES"),
    experienceType: z.string().trim().min(2).max(100),
    capacity: z.number().int().min(1).max(10000),
    eligibility: z.string().trim().min(10).max(1000)
  }).strict(),
  z.object({
    category: z.literal("OTHER_SERVICES"),
    serviceType: z.string().trim().min(2).max(100),
    scarceResource: z.string().trim().min(10).max(500),
    fulfilmentEvidence: z.string().trim().min(10).max(500)
  }).strict()
]);

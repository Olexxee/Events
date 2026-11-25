import { z } from "zod";

const uuid = z.string().uuid();
const category = z.enum([
  "ACCOMMODATION",
  "DINING",
  "DRINKS",
  "TABLES_LOUNGES",
  "VIP_EXPERIENCES",
  "OTHER_SERVICES"
]);
const location = z.object({
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional()
}).strict();
const common = {
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(30).max(3000),
  mediaRefs: z.array(z.string().trim().min(5).max(1000)).max(12).default([]),
  inclusions: z.array(z.string().trim().min(2).max(200)).max(30).default([]),
  exclusions: z.array(z.string().trim().min(2).max(200)).max(30).default([]),
  location,
  eventAssociation: z.enum(["PROVIDER_WIDE", "EVENT_SPECIFIC", "EVENT_ASSOCIATED"]),
  eventId: uuid.optional(),
  price: z.object({
    amountMinor: z.string().regex(/^\\d{1,18}$/),
    currency: z.literal("NGN"),
    unit: z.enum(["PER_PERSON", "PER_ITEM", "PER_PACKAGE", "PER_NIGHT", "PER_SESSION", "PER_TABLE"])
  }).strict(),
  cancellationTerms: z.string().trim().min(20).max(2000),
  fulfilmentTerms: z.string().trim().min(20).max(2000)
};
const categoryAttributes = z.discriminatedUnion("category", [
  z.object({ category: z.literal("ACCOMMODATION"), propertyType: z.enum(["HOTEL", "APARTMENT", "GUESTHOUSE", "HOSTEL", "VILLA"]), roomCategory: z.string().trim().min(2).max(100), maxOccupancy: z.number().int().min(1).max(30), checkInTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/), checkOutTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/) }).strict(),
  z.object({ category: z.literal("DINING"), cuisine: z.string().trim().min(2).max(100), servicePeriods: z.array(z.string().trim().min(2).max(80)).min(1).max(8), minPartySize: z.number().int().min(1).max(50), maxPartySize: z.number().int().min(1).max(100), reservationDurationMinutes: z.number().int().min(15).max(600) }).strict().refine(v => v.maxPartySize >= v.minPartySize, { path: ["maxPartySize"], message: "Maximum party size must be at least the minimum" }),
  z.object({ category: z.literal("DRINKS"), packageType: z.string().trim().min(2).max(100), quantity: z.number().int().min(1).max(10000), serviceWindow: z.string().trim().min(2).max(160), ageRestricted: z.boolean() }).strict(),
  z.object({ category: z.literal("TABLES_LOUNGES"), resourceType: z.string().trim().min(2).max(100), minOccupancy: z.number().int().min(1).max(100), maxOccupancy: z.number().int().min(1).max(300), durationMinutes: z.number().int().min(15).max(1440) }).strict().refine(v => v.maxOccupancy >= v.minOccupancy, { path: ["maxOccupancy"], message: "Maximum occupancy must be at least the minimum" }),
  z.object({ category: z.literal("VIP_EXPERIENCES"), experienceType: z.string().trim().min(2).max(100), capacity: z.number().int().min(1).max(10000), eligibility: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ category: z.literal("OTHER_SERVICES"), serviceType: z.string().trim().min(2).max(100), scarceResource: z.string().trim().min(10).max(500), fulfilmentEvidence: z.string().trim().min(10).max(500) }).strict()
]);
const content = z.object({
  ...common,
  attributes: categoryAttributes
}).strict().superRefine((value, ctx) => {
  if (value.attributes.category === "ACCOMMODATION" && value.price.unit !== "PER_NIGHT") {
    ctx.addIssue({ code: "custom", path: ["price", "unit"], message: "Accommodation prices must use PER_NIGHT" });
  }
  if (value.eventAssociation === "PROVIDER_WIDE" && value.eventId) {
    ctx.addIssue({ code: "custom", path: ["eventId"], message: "Provider-wide offerings cannot reference an event" });
  }
  if (value.eventAssociation !== "PROVIDER_WIDE" && !value.eventId) {
    ctx.addIssue({ code: "custom", path: ["eventId"], message: "Event-associated offerings require an event ID" });
  }
});

export const createVybeOfferingSchema = z.object({
  params: z.object({}),
  query: z.object({}),
  body: z.object({ organizationId: uuid, category, content }).superRefine((value, ctx) => { if (value.category !== value.content.attributes.category) ctx.addIssue({ code: "custom", path: ["content", "attributes", "category"], message: "Offering category and category attributes must match" }); })
});
export const updateVybeOfferingDraftSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({}),
  body: z.object({ content })
});
export const publishVybeOfferingSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({}),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});
export const listVybeCatalogueSchema = z.object({
  params: z.object({}),
  query: z.object({ category: category.optional(), state: z.string().trim().min(2).max(100).optional(), city: z.string().trim().min(2).max(100).optional() }),
  body: z.preprocess((value) => value ?? {}, z.object({}))
});
export const activateVybeCategorySchema = z.object({
  params: z.object({ category }),
  query: z.object({}),
  body: z.object({
    active: z.boolean(),
    reason: z.string().trim().min(15).max(1000),
    checks: z.array(z.object({
      key: z.string().trim().min(3).max(100),
      completed: z.literal(true),
      evidenceReference: z.string().trim().min(5).max(1000),
      notes: z.string().trim().min(5).max(500)
    }).strict()).max(20)
  })
});

export type VybeOfferingContent = z.infer<typeof content>;
export type VybeOfferingCategory = z.infer<typeof category>;

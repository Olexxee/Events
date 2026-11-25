import { z } from "zod";

const uuid = z.string().uuid();
const scheduleSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    label: z.string().trim().min(1).max(120).optional()
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "Schedule end must be after its start",
    path: ["endsAt"]
  });
const venueSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    country: z.string().trim().min(1).max(100).optional(),
    exactAddress: z.string().trim().min(1).max(500).optional(),
    accessInstructions: z.string().trim().max(10000).optional(),
    privateUrl: z.string().url().max(1000).optional()
  })
  .optional();

const eventFields = {
  categoryId: uuid,
  title: z.string().trim().min(3).max(180),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  summary: z.string().trim().min(10).max(500),
  description: z.string().trim().min(20).max(20000),
  format: z.enum(["IN_PERSON", "ONLINE", "HYBRID"]),
  visibility: z
    .enum(["PUBLIC", "UNLISTED", "INVITATION_ONLY"])
    .default("PUBLIC"),
  accessPolicy: z
    .enum(["OPEN", "APPROVAL_REQUIRED", "INVITATION_ONLY"])
    .default("OPEN"),
  experienceLevel: z.enum(["STANDARD", "PREMIUM"]).nullable().optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Timezone must be a valid IANA timezone"),
  schedules: z.array(scheduleSchema).min(1).max(100),
  venue: venueSchema
};

export const createEventSchema = z.object({
  body: z.object({ organizationId: uuid, ...eventFields }),
  params: z.object({}),
  query: z.object({})
});
export const updateEventSchema = z.object({
  body: z.object(eventFields),
  params: z.object({ id: uuid }),
  query: z.object({})
});
export const eventIdSchema = z.object({
  body: z.object({}),
  params: z.object({ id: uuid }),
  query: z.object({})
});
export const publicEventsQuerySchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    category: z.string().trim().min(1).max(80).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

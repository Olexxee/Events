import { z } from "zod";

const uuid = z.string().uuid();
const benefitSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(1000),
  validForMinutes: z.number().int().min(1).max(10080).optional()
});
export const createTicketTypeSchema = z.object({
  params: z.object({ eventId: uuid }),
  body: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    admissionClass: z.string().trim().max(120).optional(),
    priceMinor: z.string().regex(/^\\d{1,18}$/),
    currency: z.literal("NGN").default("NGN"),
    benefits: z.array(benefitSchema).max(30).default([]),
    capacity: z.number().int().min(1).max(1000000),
    salesStartsAt: z.string().datetime({ offset: true }).optional(),
    salesEndsAt: z.string().datetime({ offset: true }).optional(),
    minPerOrder: z.number().int().min(1).max(100).default(1),
    maxPerOrder: z.number().int().min(1).max(100).default(10),
    transferable: z.boolean().default(false)
  }).refine((value) => value.maxPerOrder >= value.minPerOrder, {
    message: "Maximum per order must be greater than or equal to minimum per order",
    path: ["maxPerOrder"]
  }).refine((value) => !value.salesStartsAt || !value.salesEndsAt ||
    Date.parse(value.salesEndsAt) > Date.parse(value.salesStartsAt), {
    message: "Sales end must be after sales start",
    path: ["salesEndsAt"]
  })
});
export const eventIdSchema = z.object({ params: z.object({ eventId: uuid }) });
export const holdSchema = z.object({
  params: z.object({ eventId: uuid }),
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(128),
    checkoutReference: z.string().trim().min(1).max(160).optional(),
    items: z.array(z.object({
      ticketTypeId: uuid,
      quantity: z.number().int().min(1).max(100)
    })).min(1).max(20).superRefine((items, ctx) => {
      const ids = items.map((item) => item.ticketTypeId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "A ticket type may appear only once per hold" });
      }
    })
  })
});
export const holdIdSchema = z.object({ params: z.object({ id: uuid }) });

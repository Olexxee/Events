import { describe, expect, it } from "vitest";
import { createEventSchema, updateEventSchema } from "../src/modules/events/events.validators.js";

const validBody = {
  organizationId: "f1d7d7f0-cb90-4f4b-8f86-4e6a0c4b0a01",
  categoryId: "d8e1b5a2-4d3e-4d4b-9d3e-0f8b9d2a6c11",
  title: "Osun Product Community Meetup",
  slug: "osun-product-community-meetup",
  summary: "A practical gathering for product builders in Osun State.",
  description: "A full day of talks, workshops and peer learning for product builders.",
  format: "IN_PERSON",
  visibility: "PUBLIC",
  accessPolicy: "OPEN",
  timezone: "Africa/Lagos",
  schedules: [{ startsAt: "2027-02-10T09:00:00+01:00", endsAt: "2027-02-10T17:00:00+01:00" }],
  venue: { displayName: "Innovation Hub", city: "Osogbo", state: "Osun", country: "Nigeria" }
};

describe("event validation", () => {
  it("accepts a valid event draft with an IANA timezone and schedule", () => {
    expect(createEventSchema.safeParse({ body: validBody, params: {}, query: {} }).success).toBe(true);
  });

  it("rejects a schedule whose end is not after its start", () => {
    const body = { ...validBody, schedules: [{ startsAt: "2027-02-10T17:00:00Z", endsAt: "2027-02-10T17:00:00Z" }] };
    expect(createEventSchema.safeParse({ body, params: {}, query: {} }).success).toBe(false);
  });

  it("rejects an invalid IANA timezone", () => {
    const body = { ...validBody, timezone: "Africa/Imaginary_City" };
    expect(createEventSchema.safeParse({ body, params: {}, query: {} }).success).toBe(false);
  });

  it("rejects a non-UUID event identifier", () => {
    expect(updateEventSchema.safeParse({ body: validBody, params: { id: "not-a-uuid" }, query: {} }).success).toBe(false);
  });

  it("keeps visibility and access policy as independent fields", () => {
    const body = { ...validBody, visibility: "UNLISTED", accessPolicy: "APPROVAL_REQUIRED" };
    const parsed = createEventSchema.safeParse({ body, params: {}, query: {} });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.body.visibility).toBe("UNLISTED");
      expect(parsed.data.body.accessPolicy).toBe("APPROVAL_REQUIRED");
    }
  });
});

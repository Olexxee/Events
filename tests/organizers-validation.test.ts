import { describe, expect, it } from "vitest";
import {
  decideOrganizerApplicationSchema,
  submitOrganizerApplicationSchema
} from "../src/modules/organizers/organizers.validators.js";

describe("organizer application validation", () => {
  it("accepts a basic application for an existing organization", () => {
    const result = submitOrganizerApplicationSchema.safeParse({
      body: {
        organizationId: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b",
        applicationMessage:
          "I organize community music events and want to publish our next programme.",
        websiteUrl: "https://example.com"
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(true);
  });

  it("rejects incomplete applications", () => {
    const result = submitOrganizerApplicationSchema.safeParse({
      body: {
        organizationId: "not-a-uuid",
        applicationMessage: "Please approve me"
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(false);
  });

  it("requires a reason for an approval or rejection decision", () => {
    const result = decideOrganizerApplicationSchema.safeParse({
      body: { decision: "REJECTED", reason: "No" },
      params: { id: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b" },
      query: {}
    });

    expect(result.success).toBe(false);
  });

  it("rejects decisions outside the supported final outcomes", () => {
    const result = decideOrganizerApplicationSchema.safeParse({
      body: {
        decision: "SUSPENDED",
        reason: "This decision is not supported."
      },
      params: { id: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b" },
      query: {}
    });

    expect(result.success).toBe(false);
  });
});

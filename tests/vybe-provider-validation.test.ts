import { describe, expect, it } from "vitest";
import {
  addVybeProviderEvidenceSchema,
  reviewVybeProviderApplicationSchema,
  submitVybeProviderApplicationSchema
} from "../src/modules/vybe-provider/vybe-provider.validators.js";

const organizationId = "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b";
const applicationId = "c0d32c50-7c6c-4c1c-b09c-c9e2b06e42f3";

describe("Vybe provider application validation", () => {
  it("accepts a category-scoped application with authority attestation and locations", () => {
    const result = submitVybeProviderApplicationSchema.safeParse({
      body: {
        organizationId,
        category: "ACCOMMODATION",
        serviceDescription:
          "We operate a small collection of serviced apartments.",
        supplyAuthorityStatement:
          "Our organization owns and directly operates these apartments.",
        supplyAuthorityAttested: true,
        termsAccepted: true,
        locations: [{ city: "Ile-Ife", state: "Osun", country: "Nigeria" }]
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(true);
  });

  it("rejects applications without the supply authority attestation", () => {
    const result = submitVybeProviderApplicationSchema.safeParse({
      body: {
        organizationId,
        category: "DINING",
        serviceDescription:
          "We operate a restaurant and offer table reservations.",
        supplyAuthorityStatement: "We own and operate the restaurant.",
        supplyAuthorityAttested: false,
        termsAccepted: true,
        locations: [{ city: "Lagos", state: "Lagos", country: "Nigeria" }]
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(false);
  });

  it("requires a reason for every evidence item", () => {
    const result = submitVybeProviderApplicationSchema.safeParse({
      body: {
        organizationId,
        category: "DINING",
        serviceDescription:
          "We operate a restaurant and offer table reservations.",
        supplyAuthorityStatement: "We own and operate the restaurant.",
        supplyAuthorityAttested: true,
        termsAccepted: true,
        locations: [{ city: "Lagos", state: "Lagos", country: "Nigeria" }],
        evidence: [
          {
            evidenceType: "food-safety",
            requirementReason: "short",
            storageReference: "private://evidence/food-safety"
          }
        ]
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(false);
  });

  it("validates category review decisions and evidence outcomes", () => {
    const result = reviewVybeProviderApplicationSchema.safeParse({
      body: {
        decision: "APPROVED",
        reason: "Required evidence has been reviewed and accepted.",
        conditions: ["Approval is limited to the submitted locations."],
        evidenceDecisions: [
          {
            evidenceId: applicationId,
            status: "ACCEPTED",
            reason: "The submitted document is current and relevant."
          }
        ]
      },
      params: { id: applicationId },
      query: {}
    });

    expect(result.success).toBe(true);
  });

  it("validates requested evidence resubmission", () => {
    const result = addVybeProviderEvidenceSchema.safeParse({
      body: {
        evidence: [
          {
            evidenceType: "food-safety",
            requirementReason: "Requested by the provider review team.",
            storageReference: "private://evidence/food-safety"
          }
        ]
      },
      params: { id: applicationId },
      query: {}
    });

    expect(result.success).toBe(true);
  });
});

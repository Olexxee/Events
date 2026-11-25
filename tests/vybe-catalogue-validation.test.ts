import { describe, expect, it } from "vitest";
import {
  activateVybeCategorySchema,
  createVybeOfferingSchema,
  listVybeCatalogueSchema,
  publishVybeOfferingSchema
} from "../src/modules/vybe-catalogue/vybe-catalogue.validators.js";

const offeringContent = {
  title: "A quiet serviced apartment",
  description: "A furnished apartment close to the city centre for short stays.",
  mediaRefs: [],
  inclusions: ["Wi-Fi", "Air conditioning"],
  exclusions: ["Airport transfer"],
  location: { city: "Ile-Ife", state: "Osun", country: "Nigeria" },
  eventAssociation: "PROVIDER_WIDE",
  price: { amountMinor: "4500000", currency: "NGN", unit: "PER_NIGHT" },
  cancellationTerms: "Cancellation terms are disclosed before customer commitment.",
  fulfilmentTerms: "The provider confirms check-in instructions before arrival.",
  attributes: {
    category: "ACCOMMODATION",
    propertyType: "APARTMENT",
    roomCategory: "One-bedroom apartment",
    maxOccupancy: 2,
    checkInTime: "14:00",
    checkOutTime: "11:00"
  }
};

describe("Vybe catalogue validation", () => {
  it("accepts a category-matched accommodation draft", () => {
    const result = createVybeOfferingSchema.safeParse({
      params: {},
      query: {},
      body: {
        organizationId: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b",
        category: "ACCOMMODATION",
        content: offeringContent
      }
    });
    expect(result.success).toBe(true);
  });

  it("rejects category attributes that do not match the offering category", () => {
    const result = createVybeOfferingSchema.safeParse({
      params: {},
      query: {},
      body: {
        organizationId: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b",
        category: "DINING",
        content: offeringContent
      }
    });
    expect(result.success).toBe(false);
  });

  it("requires accommodation pricing to be per night", () => {
    const result = createVybeOfferingSchema.safeParse({
      params: {},
      query: {},
      body: {
        organizationId: "7a7dbf1e-1b23-4f45-9f30-cc68a0d6f23b",
        category: "ACCOMMODATION",
        content: {
          ...offeringContent,
          price: { ...offeringContent.price, unit: "PER_PACKAGE" }
        }
      }
    });
    expect(result.success).toBe(false);
  });

  it("accepts public catalogue queries and publish requests without bodies", () => {
    expect(listVybeCatalogueSchema.safeParse({
      params: {},
      query: { category: "ACCOMMODATION", city: "Ile-Ife" },
      body: undefined
    }).success).toBe(true);
    expect(publishVybeOfferingSchema.safeParse({
      params: { id: "c0d32c50-7c6c-4c1c-b09c-c9e2b06e42f3" },
      query: {},
      body: undefined
    }).success).toBe(true);
  });

  it("validates evidence-backed activation check entries", () => {
    expect(activateVybeCategorySchema.safeParse({
      params: { category: "ACCOMMODATION" },
      query: {},
      body: {
        active: true,
        reason: "Accommodation launch readiness was reviewed.",
        checks: [{
          key: "secured_room_category_allocation",
          completed: true,
          evidenceReference: "ops://readiness/accommodation/allocation",
          notes: "Signed room category allocation is on file."
        }]
      }
    }).success).toBe(true);
  });
});

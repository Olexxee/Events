import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import { listPublicOfferings } from "../src/modules/vybe-catalogue/vybe-catalogue.db.js";
import {
  createAccommodationHold,
  getAccommodationAvailability,
  getMyAccommodationHold,
  releaseMyAccommodationHold
} from "../src/modules/vybe-accommodation/vybe-accommodation.holds.db.js";
import {
  adjustAccommodationAllocationNight,
  createAccommodationAllocation,
  createAccommodationProperty,
  createAccommodationRoomCategory,
  releaseAccommodationAllocation,
  updateAccommodationPhysicalCapacity
} from "../src/modules/vybe-accommodation/vybe-accommodation.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe accommodation supply PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    async function createFixture() {
      const user = await prisma.user.create({
        data: {
          email: `vybe-accommodation-${crypto.randomUUID()}@events.test`,
          emailVerifiedAt: new Date()
        }
      });
      const organization = await prisma.organization.create({
        data: {
          name: "Vybe Accommodation Provider",
          slug: `vybe-accommodation-${crypto.randomUUID()}`,
          createdById: user.id,
          memberships: {
            create: { userId: user.id, role: "OWNER", status: "ACTIVE" }
          }
        }
      });
      const profile = await prisma.vybeProviderProfile.create({
        data: { organizationId: organization.id }
      });
      const application = await prisma.vybeProviderApplication.create({
        data: {
          organizationId: organization.id,
          applicantUserId: user.id,
          category: "ACCOMMODATION",
          serviceDescription:
            "We operate accommodation properties for short stays.",
          supplyAuthorityStatement:
            "Our organization owns and operates the listed property.",
          supplyAuthorityAttested: true,
          termsVersion: "vybe-provider-v1",
          termsAcceptedAt: new Date(),
          status: "APPROVED"
        }
      });
      await prisma.vybeProviderApproval.create({
        data: {
          applicationId: application.id,
          providerProfileId: profile.id,
          category: "ACCOMMODATION",
          status: "ACTIVE",
          locations: [{ city: "Ile-Ife", state: "Osun", country: "Nigeria" }],
          approvedByUserId: user.id
        }
      });
      const offering = await prisma.vybeOffering.create({
        data: {
          providerProfileId: profile.id,
          category: "ACCOMMODATION",
          status: "PUBLISHED",
          currentPublishedVersion: 1,
          createdByUserId: user.id,
          versions: {
            create: {
              version: 1,
              status: "PUBLISHED",
              content: {
                title: "Standard room",
                description:
                  "A standard room with a private bathroom and basic amenities.",
                mediaRefs: [],
                inclusions: ["Private bathroom"],
                exclusions: [],
                location: {
                  city: "Ile-Ife",
                  state: "Osun",
                  country: "Nigeria"
                },
                eventAssociation: "PROVIDER_WIDE",
                price: {
                  amountMinor: "2500000",
                  currency: "NGN",
                  unit: "PER_NIGHT"
                },
                cancellationTerms:
                  "Cancellation is governed by the published provider terms.",
                fulfilmentTerms:
                  "The provider supplies the booked room for the confirmed stay.",
                attributes: {
                  category: "ACCOMMODATION",
                  propertyType: "HOTEL",
                  roomCategory: "Standard",
                  maxOccupancy: 2,
                  checkInTime: "14:00",
                  checkOutTime: "11:00"
                }
              },
              createdByUserId: user.id,
              publishedAt: new Date()
            }
          }
        }
      });
      return { user, organization, profile, offering };
    }

    async function createPropertyAndCategory(
      fixture: Awaited<ReturnType<typeof createFixture>>
    ) {
      const property = await createAccommodationProperty({
        organizationId: fixture.organization.id,
        actorUserId: fixture.user.id,
        providerPropertyKey: "main-property",
        name: "Vybe Test Hotel",
        addressLine: "12 Test Street",
        city: "Ile-Ife",
        state: "Osun",
        country: "Nigeria",
        timezone: "Africa/Lagos"
      });
      const roomCategory = await createAccommodationRoomCategory({
        propertyId: property.id,
        actorUserId: fixture.user.id,
        providerCategoryKey: "standard",
        name: "Standard",
        maxOccupancy: 2,
        physicalUnitCount: 12,
        physicalUnitCountEvidenceReference:
          "private://provider/room-register-12",
        specifications: { bedType: "queen", bathroom: "private" },
        offeringId: fixture.offering.id
      });
      return { property, roomCategory };
    }

    async function createAllocation(
      fixture: Awaited<ReturnType<typeof createFixture>>,
      roomCategoryId: string,
      quantities: number[] = [8, 8]
    ) {
      const dates = ["2027-06-10", "2027-06-11"].slice(0, quantities.length);
      return createAccommodationAllocation({
        roomCategoryId,
        actorUserId: fixture.user.id,
        startDate: dates[0] as string,
        endDate: quantities.length === 1 ? "2027-06-11" : "2027-06-12",
        releaseCutoffLocal: "2027-06-01T12:00:00+01:00",
        agreementReference: "provider-agreement:vybe-2027-01",
        evidenceReference: "private://provider/allocation-agreement-2027-01",
        nights: dates.map((stayDate, index) => ({
          stayDate,
          allocatedQuantity: quantities[index] as number
        }))
      });
    }

  
  async function withAccommodationActivation<T>(
    userId: string,
    callback: () => Promise<T>
  ) {
    const previous = await prisma.vybeCategoryActivation.findUnique({
      where: { category: "ACCOMMODATION" }
    });
    await prisma.vybeCategoryActivation.upsert({
      where: { category: "ACCOMMODATION" },
      create: {
        category: "ACCOMMODATION",
        isActive: true,
        checklist: [],
        reason: "Accommodation hold integration test",
        activatedByUserId: userId,
        activatedAt: new Date()
      },
      update: {
        isActive: true,
        checklist: [],
        reason: "Accommodation hold integration test",
        activatedByUserId: userId,
        activatedAt: new Date()
      }
    });
    try {
      return await callback();
    } finally {
      if (previous) {
        await prisma.vybeCategoryActivation.update({
          where: { category: "ACCOMMODATION" },
          data: {
            isActive: previous.isActive,
            checklist: previous.checklist,
            reason: previous.reason,
            activatedByUserId: previous.activatedByUserId,
            activatedAt: previous.activatedAt
          }
        });
      } else {
        await prisma.vybeCategoryActivation.delete({
          where: { category: "ACCOMMODATION" }
        });
      }
    }
  }

  it("requires the property location to fall within the active provider approval", async () => {
      const fixture = await createFixture();
      await expect(
        createAccommodationProperty({
          organizationId: fixture.organization.id,
          actorUserId: fixture.user.id,
          providerPropertyKey: "outside-location",
          name: "Outside Location Hotel",
          city: "Lagos",
          state: "Lagos",
          country: "Nigeria",
          timezone: "Africa/Lagos"
        })
      ).rejects.toMatchObject({
        code: "VYBE_PROVIDER_LOCATION_NOT_APPROVED"
      });
    });

    it("creates provider-owned properties and evidence-backed room categories", async () => {
      const fixture = await createFixture();
      const { property, roomCategory } =
        await createPropertyAndCategory(fixture);

      expect(property.providerProfileId).toBe(fixture.profile.id);
      expect(property.timezone).toBe("Africa/Lagos");
      expect(roomCategory.providerProfileId).toBe(fixture.profile.id);
      expect(roomCategory.physicalUnitCount).toBe(12);
      expect(roomCategory.physicalUnitCountEvidenceReference).toBe(
        "private://provider/room-register-12"
      );
      expect(
        await prisma.outboxMessage.findFirst({
          where: {
            aggregateId: roomCategory.id,
            eventType: "vybe.accommodation.room_category_created.v1"
          }
        })
      ).not.toBeNull();
    });

    it("does not advertise an accommodation offering before room-night supply is allocated", async () => {
      const fixture = await createFixture();
      const previousActivation = await prisma.vybeCategoryActivation.findUnique(
        {
          where: { category: "ACCOMMODATION" }
        }
      );
      await prisma.vybeCategoryActivation.upsert({
        where: { category: "ACCOMMODATION" },
        create: {
          category: "ACCOMMODATION",
          isActive: true,
          checklist: [],
          reason: "Integration test activation",
          activatedByUserId: fixture.user.id,
          activatedAt: new Date()
        },
        update: {
          isActive: true,
          checklist: [],
          reason: "Integration test activation",
          activatedByUserId: fixture.user.id,
          activatedAt: new Date()
        }
      });

      try {
        const { roomCategory } = await createPropertyAndCategory(fixture);
        const beforeAllocation = await listPublicOfferings({
          category: "ACCOMMODATION"
        });
        expect(
          beforeAllocation.some(
            (offering) => offering.id === fixture.offering.id
          )
        ).toBe(false);

        await createAllocation(fixture, roomCategory.id, [3, 3]);
        const afterAllocation = await listPublicOfferings({
          category: "ACCOMMODATION"
        });
        expect(
          afterAllocation.some(
            (offering) => offering.id === fixture.offering.id
          )
        ).toBe(true);
      } finally {
        if (previousActivation) {
          await prisma.vybeCategoryActivation.update({
            where: { category: "ACCOMMODATION" },
            data: {
              isActive: previousActivation.isActive,
              checklist: previousActivation.checklist,
              reason: previousActivation.reason,
              activatedByUserId: previousActivation.activatedByUserId,
              activatedAt: previousActivation.activatedAt
            }
          });
        } else {
          await prisma.vybeCategoryActivation.delete({
            where: { category: "ACCOMMODATION" }
          });
        }
      }
    });

    it("creates complete room-night allocation lots and append-only initial adjustments", async () => {
      const fixture = await createFixture();
      const { roomCategory } = await createPropertyAndCategory(fixture);
      const allocation = await createAllocation(fixture, roomCategory.id);

      expect(allocation.nights).toHaveLength(2);
      expect(allocation.termsVersion).toBe("vybe-provider-v1");
      expect(allocation.releaseCutoffTimezone).toBe("Africa/Lagos");
      expect(
        await prisma.vybeAccommodationAllocationAdjustment.count({
          where: {
            allocationNightId: {
              in: allocation.nights.map((night) => night.id)
            }
          }
        })
      ).toBe(2);
      expect(
        await prisma.outboxMessage.findFirst({
          where: {
            aggregateId: allocation.id,
            eventType: "vybe.accommodation.allocation_created.v1"
          }
        })
      ).not.toBeNull();
    });

    it("rejects incomplete room-night ranges and cutoffs with a mismatched timezone offset", async () => {
      const fixture = await createFixture();
      const { roomCategory } = await createPropertyAndCategory(fixture);

      await expect(
        createAccommodationAllocation({
          roomCategoryId: roomCategory.id,
          actorUserId: fixture.user.id,
          startDate: "2027-06-10",
          endDate: "2027-06-12",
          releaseCutoffLocal: "2027-06-01T12:00:00+01:00",
          agreementReference: "provider-agreement:incomplete",
          evidenceReference: "private://provider/incomplete",
          nights: [{ stayDate: "2027-06-10", allocatedQuantity: 3 }]
        })
      ).rejects.toMatchObject({ code: "VYBE_ACCOMMODATION_NIGHTS_INCOMPLETE" });

      await expect(
        createAccommodationAllocation({
          roomCategoryId: roomCategory.id,
          actorUserId: fixture.user.id,
          startDate: "2027-06-10",
          endDate: "2027-06-11",
          releaseCutoffLocal: "2027-06-01T12:00:00+00:00",
          agreementReference: "provider-agreement:timezone",
          evidenceReference: "private://provider/timezone",
          nights: [{ stayDate: "2027-06-10", allocatedQuantity: 3 }]
        })
      ).rejects.toMatchObject({
        code: "VYBE_ACCOMMODATION_CUTOFF_TIMEZONE_MISMATCH"
      });
    });

    it("enforces aggregate physical room capacity across provider allocation lots", async () => {
      const fixture = await createFixture();
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [8, 8]);

      await expect(
        createAccommodationAllocation({
          roomCategoryId: roomCategory.id,
          actorUserId: fixture.user.id,
          startDate: "2027-06-10",
          endDate: "2027-06-12",
          releaseCutoffLocal: "2027-06-01T12:00:00+01:00",
          agreementReference: "provider-agreement:overflow",
          evidenceReference: "private://provider/overflow",
          nights: [
            { stayDate: "2027-06-10", allocatedQuantity: 5 },
            { stayDate: "2027-06-11", allocatedQuantity: 5 }
          ]
        })
      ).rejects.toThrow();
    });

    it("records evidence for capacity changes and rejects reductions below allocations", async () => {
      const fixture = await createFixture();
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [8, 8]);

      const updated = await updateAccommodationPhysicalCapacity({
        roomCategoryId: roomCategory.id,
        actorUserId: fixture.user.id,
        physicalUnitCount: 11,
        evidenceReference: "private://provider/room-register-11",
        reason:
          "The physical room count was reconciled against the current register."
      });
      expect(updated.physicalUnitCount).toBe(11);

      await expect(
        updateAccommodationPhysicalCapacity({
          roomCategoryId: roomCategory.id,
          actorUserId: fixture.user.id,
          physicalUnitCount: 7,
          evidenceReference: "private://provider/room-register-7",
          reason: "Physical room count was reduced after inspection."
        })
      ).rejects.toThrow();
    });

  
  it("reports availability per local stay night using the full hold window", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [4, 3]);
      const availability = await getAccommodationAvailability({
        roomCategoryId: roomCategory.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 3
      });

      expect(availability.holdDurationSeconds).toBe(600);
      expect(availability.nights).toEqual([
        { stayDate: "2027-06-10", availableQuantity: 4 },
        { stayDate: "2027-06-11", availableQuantity: 3 }
      ]);
      expect(availability.minimumAvailableQuantity).toBe(3);
      expect(availability.isAvailable).toBe(true);
    });
  });

  it("creates multi-night holds across allocation lots and replays idempotently", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAccommodationAllocation({
        roomCategoryId: roomCategory.id,
        actorUserId: fixture.user.id,
        startDate: "2027-06-10",
        endDate: "2027-06-12",
        releaseCutoffLocal: "2027-06-01T12:00:00+01:00",
        agreementReference: "provider-agreement:hold-lot-one",
        evidenceReference: "private://provider/hold-lot-one",
        nights: [
          { stayDate: "2027-06-10", allocatedQuantity: 1 },
          { stayDate: "2027-06-11", allocatedQuantity: 1 }
        ]
      });
      await createAccommodationAllocation({
        roomCategoryId: roomCategory.id,
        actorUserId: fixture.user.id,
        startDate: "2027-06-10",
        endDate: "2027-06-12",
        releaseCutoffLocal: "2027-06-02T12:00:00+01:00",
        agreementReference: "provider-agreement:hold-lot-two",
        evidenceReference: "private://provider/hold-lot-two",
        nights: [
          { stayDate: "2027-06-10", allocatedQuantity: 2 },
          { stayDate: "2027-06-11", allocatedQuantity: 2 }
        ]
      });

      const request = {
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2,
        idempotencyKey: "accommodation-hold-001"
      };
      const hold = await createAccommodationHold(request);
      const replay = await createAccommodationHold(request);
      expect(replay.id).toBe(hold.id);
      expect(hold.nights).toHaveLength(4);
      expect(hold.nights.reduce((sum, night) => sum + night.quantity, 0)).toBe(4);
      expect(hold.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);

      await expect(
        createAccommodationHold({
          ...request,
          roomQuantity: 1
        })
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });
  });

  it("serializes concurrent holds so the same room-night capacity cannot be held twice", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [8, 8]);

      const results = await Promise.allSettled([
        createAccommodationHold({
          roomCategoryId: roomCategory.id,
          userId: fixture.user.id,
          checkInDate: "2027-06-10",
          checkOutDate: "2027-06-12",
          roomQuantity: 7,
          idempotencyKey: "concurrent-accommodation-hold-1"
        }),
        createAccommodationHold({
          roomCategoryId: roomCategory.id,
          userId: fixture.user.id,
          checkInDate: "2027-06-10",
          checkOutDate: "2027-06-12",
          roomQuantity: 7,
          idempotencyKey: "concurrent-accommodation-hold-2"
        })
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const availability = await getAccommodationAvailability({
        roomCategoryId: roomCategory.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2
      });
      expect(availability.minimumAvailableQuantity).toBe(1);
      expect(availability.isAvailable).toBe(false);
    });
  });

  it("expires stale holds synchronously before admitting replacement inventory", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [2, 2]);
      const first = await createAccommodationHold({
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2,
        idempotencyKey: "expired-accommodation-hold-1"
      });
      await prisma.vybeAccommodationHold.update({
        where: { id: first.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });

      const replacement = await createAccommodationHold({
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2,
        idempotencyKey: "expired-accommodation-hold-2"
      });
      const expired = await prisma.vybeAccommodationHold.findUniqueOrThrow({
        where: { id: first.id }
      });
      expect(expired.status).toBe("EXPIRED");
      expect(replacement.status).toBe("ACTIVE");
    });
  });

  it("enforces hold ownership and releases inventory when the owner cancels", async () => {
    const fixture = await createFixture();
    const otherUser = await prisma.user.create({
      data: {
        email: `vybe-accommodation-other-${crypto.randomUUID()}@events.test`,
        emailVerifiedAt: new Date()
      }
    });
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [3, 3]);
      const hold = await createAccommodationHold({
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2,
        idempotencyKey: "owned-accommodation-hold-1"
      });

      await expect(
        getMyAccommodationHold({ holdId: hold.id, userId: otherUser.id })
      ).rejects.toMatchObject({ code: "VYBE_ACCOMMODATION_HOLD_FORBIDDEN" });
      const released = await releaseMyAccommodationHold({
        holdId: hold.id,
        userId: fixture.user.id
      });
      expect(released.status).toBe("RELEASED");
      const availability = await getAccommodationAvailability({
        roomCategoryId: roomCategory.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 3
      });
      expect(availability.minimumAvailableQuantity).toBe(3);
    });
  });

  it("does not hold inventory when a provider cutoff is inside the hold window", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      const allocation = await createAllocation(fixture, roomCategory.id, [3, 3]);
      await prisma.vybeAccommodationAllocation.update({
        where: { id: allocation.id },
        data: { releaseCutoffAt: new Date(Date.now() + 5 * 60 * 1000) }
      });

      const availability = await getAccommodationAvailability({
        roomCategoryId: roomCategory.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 1
      });
      expect(availability.minimumAvailableQuantity).toBe(0);
      expect(availability.isAvailable).toBe(false);
      await expect(
        createAccommodationHold({
          roomCategoryId: roomCategory.id,
          userId: fixture.user.id,
          checkInDate: "2027-06-10",
          checkOutDate: "2027-06-12",
          roomQuantity: 1,
          idempotencyKey: "cutoff-accommodation-hold-1"
        })
      ).rejects.toMatchObject({
        code: "VYBE_INSUFFICIENT_ACCOMMODATION_INVENTORY"
      });
    });
  });


  it("rejects a hold header without a complete set of room-night details", async () => {
    const fixture = await createFixture();
    const { roomCategory } = await createPropertyAndCategory(fixture);

    await expect(
      prisma.vybeAccommodationHold.create({
        data: {
          roomCategoryId: roomCategory.id,
          userId: fixture.user.id,
          idempotencyKey: "incomplete-accommodation-hold",
          requestHash: "b".repeat(64),
          checkInDate: new Date("2027-06-10T00:00:00.000Z"),
          checkOutDate: new Date("2027-06-12T00:00:00.000Z"),
          roomQuantity: 2,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          snapshot: {}
        }
      })
    ).rejects.toThrow();
  });

  it("keeps hold request and per-night allocation snapshots immutable", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      await createAllocation(fixture, roomCategory.id, [3, 3]);
      const hold = await createAccommodationHold({
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
        roomQuantity: 2,
        idempotencyKey: "immutable-accommodation-hold"
      });
      const firstNight = hold.nights[0];
      if (!firstNight) throw new Error("Expected a hold-night detail");

      await expect(
        prisma.vybeAccommodationHold.update({
          where: { id: hold.id },
          data: { roomQuantity: 1 }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeAccommodationHoldNight.update({
          where: { id: firstNight.id },
          data: { quantity: firstNight.quantity + 1 }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeAccommodationHold.update({
          where: { id: hold.id },
          data: { expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
        })
      ).rejects.toThrow();
    });
  });

  it("expires stale holds before a provider reduces allocated room quantity", async () => {
    const fixture = await createFixture();
    await withAccommodationActivation(fixture.user.id, async () => {
      const { roomCategory } = await createPropertyAndCategory(fixture);
      const allocation = await createAllocation(fixture, roomCategory.id, [3]);
      const hold = await createAccommodationHold({
        roomCategoryId: roomCategory.id,
        userId: fixture.user.id,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-11",
        roomQuantity: 2,
        idempotencyKey: "provider-reduction-after-expiry"
      });
      await prisma.vybeAccommodationHold.update({
        where: { id: hold.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      await prisma.vybeAccommodationAllocation.update({
        where: { id: allocation.id },
        data: { releaseCutoffAt: new Date(Date.now() - 1000) }
      });

      const night = allocation.nights[0];
      if (!night) throw new Error("Expected an allocation night");
      const result = await adjustAccommodationAllocationNight({
        allocationNightId: night.id,
        actorUserId: fixture.user.id,
        quantityDelta: -2,
        reason: "Provider reclaims expired, uncommitted room inventory.",
        evidenceReference: "private://provider/expired-hold-reduction"
      });
      expect(result.allocationNight.allocatedQuantity).toBe(1);
      const expired = await prisma.vybeAccommodationHold.findUniqueOrThrow({
        where: { id: hold.id }
      });
      expect(expired.status).toBe("EXPIRED");
    });
  });
  it("allows adjustments only under the allocation cutoff and releases only uncommitted, unheld lots", async () => {
      const fixture = await createFixture();
      const { roomCategory } = await createPropertyAndCategory(fixture);
      const allocation = await createAllocation(fixture, roomCategory.id, [8]);
      const night = allocation.nights[0];
      if (!night) throw new Error("Expected an allocation night");

      const increased = await adjustAccommodationAllocationNight({
        allocationNightId: night.id,
        actorUserId: fixture.user.id,
        quantityDelta: 1,
        reason: "Provider secured one additional room.",
        evidenceReference: "private://provider/additional-room-1"
      });
      expect(increased.allocationNight.allocatedQuantity).toBe(9);

      await expect(
        adjustAccommodationAllocationNight({
          allocationNightId: night.id,
          actorUserId: fixture.user.id,
          quantityDelta: -1,
          reason: "Provider requests an early reduction.",
          evidenceReference: "private://provider/early-reduction"
        })
      ).rejects.toThrow();

      const hold = await prisma.$transaction(async (tx) => {
        const created = await tx.vybeAccommodationHold.create({
          data: {
            roomCategoryId: roomCategory.id,
            userId: fixture.user.id,
            idempotencyKey: crypto.randomUUID(),
            requestHash: "a".repeat(64),
            checkInDate: new Date("2027-06-10T00:00:00.000Z"),
            checkOutDate: new Date("2027-06-11T00:00:00.000Z"),
            roomQuantity: 1,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            snapshot: {}
          }
        });
        await tx.vybeAccommodationHoldNight.create({
          data: {
            holdId: created.id,
            allocationNightId: night.id,
            roomCategoryId: roomCategory.id,
            stayDate: new Date("2027-06-10T00:00:00.000Z"),
            quantity: 1,
            releaseCutoffAtSnapshot: allocation.releaseCutoffAt,
            releaseCutoffLocalSnapshot: allocation.releaseCutoffLocal,
            releaseCutoffTimezoneSnapshot: allocation.releaseCutoffTimezone
          }
        });
        return created;
      });

      await prisma.vybeAccommodationAllocation.update({
        where: { id: allocation.id },
        data: { releaseCutoffAt: new Date(Date.now() - 1000) }
      });
      await expect(
        releaseAccommodationAllocation({
          allocationId: allocation.id,
          actorUserId: fixture.user.id,
          reason: "The provider wants to reclaim the unused allocation.",
          evidenceReference: "private://provider/release-request"
        })
      ).rejects.toThrow();

      await prisma.vybeAccommodationHold.update({
        where: { id: hold.id },
        data: { status: "RELEASED" }
      });
      const released = await releaseAccommodationAllocation({
        allocationId: allocation.id,
        actorUserId: fixture.user.id,
        reason: "The agreed cutoff has passed and no holds or bookings remain.",
        evidenceReference: "private://provider/release-confirmation"
      });
      expect(released.status).toBe("RELEASED");
    });
  }
);

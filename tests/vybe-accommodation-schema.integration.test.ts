import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe accommodation room-night schema PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    async function createFixture() {
      const suffix = crypto.randomUUID();
      const user = await prisma.user.create({
        data: { email: `vybe-accommodation-${suffix}@events.test` }
      });
      const organization = await prisma.organization.create({
        data: {
          name: `Vybe Accommodation Provider ${suffix}`,
          slug: `vybe-accommodation-${suffix}`,
          createdById: user.id,
          memberships: {
            create: { userId: user.id, role: "OWNER", status: "ACTIVE" }
          }
        }
      });
      const profile = await prisma.vybeProviderProfile.create({
        data: { organizationId: organization.id }
      });
      const offering = await prisma.vybeOffering.create({
        data: {
          providerProfileId: profile.id,
          category: "ACCOMMODATION",
          status: "DRAFT",
          createdByUserId: user.id
        }
      });
      const property = await prisma.vybeAccommodationProperty.create({
        data: {
          providerProfileId: profile.id,
          providerPropertyKey: `property-${suffix}`,
          name: "Test property",
          city: "Ibadan",
          state: "Oyo",
          country: "Nigeria",
          timezone: "Africa/Lagos"
        }
      });
      const roomCategory =
        await prisma.vybeAccommodationRoomCategory.create({
          data: {
            providerProfileId: profile.id,
            propertyId: property.id,
            providerCategoryKey: `standard-${suffix}`,
            name: "Standard room",
            maxOccupancy: 2,
            specifications: { bed: "queen", bathroom: "private" },
            offeringId: offering.id
          }
        });
      const allocation = await prisma.vybeAccommodationAllocation.create({
        data: {
          roomCategoryId: roomCategory.id,
          startDate: new Date("2027-06-10T00:00:00.000Z"),
          endDate: new Date("2027-06-12T00:00:00.000Z"),
          releaseCutoffAt: new Date("2027-06-01T11:00:00.000Z"),
          releaseCutoffLocal: "2027-06-01T12:00:00+01:00",
          releaseCutoffTimezone: "Africa/Lagos",
          agreementReference: `agreement:${suffix}`,
          termsVersion: "vybe-provider-v1",
          evidenceReference: `provider-allocation:${suffix}`,
          createdByUserId: user.id
        }
      });
      const nightLock = await prisma.vybeAccommodationNightLock.create({
        data: {
          roomCategoryId: roomCategory.id,
          stayDate: new Date("2027-06-10T00:00:00.000Z")
        }
      });
      const allocationNight =
        await prisma.vybeAccommodationAllocationNight.create({
          data: {
            allocationId: allocation.id,
            roomCategoryId: roomCategory.id,
            stayDate: nightLock.stayDate,
            allocatedQuantity: 2
          }
        });

      return {
        user,
        profile,
        offering,
        property,
        roomCategory,
        allocation,
        allocationNight
      };
    }

    async function createHold(
      fixture: Awaited<ReturnType<typeof createFixture>>,
      input: { key?: string; quantity?: number } = {}
    ) {
      return prisma.vybeAccommodationHold.create({
        data: {
          roomCategoryId: fixture.roomCategory.id,
          userId: fixture.user.id,
          idempotencyKey: input.key ?? crypto.randomUUID(),
          requestHash: "a".repeat(64),
          checkInDate: new Date("2027-06-10T00:00:00.000Z"),
          checkOutDate: new Date("2027-06-11T00:00:00.000Z"),
          roomQuantity: input.quantity ?? 1,
          expiresAt: new Date("2027-05-31T11:00:00.000Z"),
          snapshot: {
            offeringId: fixture.offering.id,
            offeringVersion: 1,
            currency: "NGN",
            unitPriceMinor: 2500000,
            cancellationTerms: { policy: "provider_terms" }
          }
        }
      });
    }

    it("enforces provider ownership across property, room category and offering", async () => {
      const fixture = await createFixture();
      const otherUser = await prisma.user.create({
        data: {
          email: `vybe-accommodation-other-${crypto.randomUUID()}@events.test`
        }
      });
      const otherOrganization = await prisma.organization.create({
        data: {
          name: "Other provider",
          slug: `vybe-accommodation-other-${crypto.randomUUID()}`,
          createdById: otherUser.id
        }
      });
      const otherProfile = await prisma.vybeProviderProfile.create({
        data: { organizationId: otherOrganization.id }
      });

      await expect(
        prisma.vybeAccommodationRoomCategory.create({
          data: {
            providerProfileId: otherProfile.id,
            propertyId: fixture.property.id,
            providerCategoryKey: "foreign-category",
            name: "Foreign category",
            maxOccupancy: 2,
            offeringId: fixture.offering.id
          }
        })
      ).rejects.toThrow();
    });

    it("enforces allocation date boundaries and positive capacity", async () => {
      const fixture = await createFixture();
      await prisma.vybeAccommodationNightLock.create({
        data: {
          roomCategoryId: fixture.roomCategory.id,
          stayDate: new Date("2027-06-12T00:00:00.000Z")
        }
      });

      await expect(
        prisma.vybeAccommodationAllocationNight.create({
          data: {
            allocationId: fixture.allocation.id,
            roomCategoryId: fixture.roomCategory.id,
            stayDate: new Date("2027-06-12T00:00:00.000Z"),
            allocatedQuantity: 1
          }
        })
      ).rejects.toThrow();

      await expect(
        prisma.vybeAccommodationAllocationNight.update({
          where: { id: fixture.allocationNight.id },
          data: { allocatedQuantity: 0 }
        })
      ).rejects.toThrow();
    });

    it("binds hold-night details to the hold date range and exact allocation cutoff snapshot", async () => {
      const fixture = await createFixture();
      const hold = await createHold(fixture);

      await expect(
        prisma.vybeAccommodationHoldNight.create({
          data: {
            holdId: hold.id,
            allocationNightId: fixture.allocationNight.id,
            roomCategoryId: fixture.roomCategory.id,
            stayDate: new Date("2027-06-10T00:00:00.000Z"),
            quantity: 1,
            releaseCutoffAtSnapshot: new Date("2027-06-01T11:00:00.000Z"),
            releaseCutoffLocalSnapshot: "2027-06-01T12:00:00+01:00",
            releaseCutoffTimezoneSnapshot: "Africa/Lagos"
          }
        })
      ).resolves.toMatchObject({ holdId: hold.id });

      const anotherHold = await createHold(fixture);
      await expect(
        prisma.vybeAccommodationHoldNight.create({
          data: {
            holdId: anotherHold.id,
            allocationNightId: fixture.allocationNight.id,
            roomCategoryId: fixture.roomCategory.id,
            stayDate: new Date("2027-06-10T00:00:00.000Z"),
            quantity: 2,
            releaseCutoffAtSnapshot: new Date("2027-06-01T11:00:00.000Z"),
            releaseCutoffLocalSnapshot: "2027-06-01T12:00:00+01:00",
            releaseCutoffTimezoneSnapshot: "Africa/Lagos"
          }
        })
      ).rejects.toThrow();
    });

    it("keeps allocation adjustments append-only", async () => {
      const fixture = await createFixture();
      const adjustment =
        await prisma.vybeAccommodationAllocationAdjustment.create({
          data: {
            allocationNightId: fixture.allocationNight.id,
            actorUserId: fixture.user.id,
            quantityDelta: 2,
            reason: "Initial provider-verified allocation",
            evidenceReference: "provider-room-register:initial"
          }
        });

      await expect(
        prisma.vybeAccommodationAllocationAdjustment.update({
          where: { id: adjustment.id },
          data: { reason: "Changed history" }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeAccommodationAllocationAdjustment.delete({
          where: { id: adjustment.id }
        })
      ).rejects.toThrow();
    });
  }
);

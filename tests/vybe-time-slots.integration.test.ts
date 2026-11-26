import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient,
} from "../src/infrastructure/database/prisma.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe time-slot schema PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    it(
      "rejects overlapping active holds for one exclusive resource and permits adjacent intervals",
      async () => {
          const suffix = crypto.randomUUID();
          const user = await prisma.user.create({
            data: { email: `vybe-time-slot-${suffix}@events.test` }
        }
      );
        const organization = await prisma.organization.create({
          data: {
            name: "Vybe Time Slot Schema Provider",
            slug: `vybe-time-slot-${suffix}`,
            createdById: user.id
          }
      }
    );
      const profile = await prisma.vybeProviderProfile.create({
        data: { organizationId: organization.id }
      });
      const offering = await prisma.vybeOffering.create({
        data: {
          providerProfileId: profile.id,
          category: "DINING",
          createdByUserId: user.id
        }
      });
      const group = await prisma.vybeTimeSlotResourceGroup.create({
        data: {
          providerProfileId: profile.id,
          offeringId: offering.id,
          name: "Dining tables"
        }
      });
      const resource = await prisma.vybeTimeSlotResource.create({
        data: {
          providerProfileId: profile.id,
          providerResourceKey: `table-${suffix}`,
          name: "Table 1",
          groups: { create: { resourceGroupId: group.id } }
        }
      });

      const serviceStartsAt = new Date("2027-02-10T20:00:00.000Z");
      const serviceEndsAt = new Date("2027-02-10T21:00:00.000Z");
      const occurrence = await prisma.vybeTimeSlotOccurrence.create({
        data: {
          offeringId: offering.id,
          offeringVersion: 1,
          inventoryMode: "EXCLUSIVE",
          timezone: "Africa/Lagos",
          serviceStartsAt,
          serviceEndsAt,
          blockedStartsAt: serviceStartsAt,
          blockedEndsAt: serviceEndsAt,
          resourceGroupId: group.id
        }
      });

      const holdData = {
        occurrenceId: occurrence.id,
        userId: user.id,
        resourceId: resource.id,
        status: "ACTIVE" as const,
        expiresAt: new Date("2027-02-10T19:55:00.000Z"),
        serviceStartsAt,
        serviceEndsAt,
        blockedStartsAt: serviceStartsAt,
        blockedEndsAt: serviceEndsAt
      };

      await prisma.vybeTimeSlotHold.create({
        data: { ...holdData, idempotencyKey: `first-${suffix}` }
      });

      await expect(
        prisma.vybeTimeSlotHold.create({
          data: {
            ...holdData,
            idempotencyKey: `overlap-${suffix}`,
            serviceStartsAt: new Date("2027-02-10T20:30:00.000Z"),
            serviceEndsAt: new Date("2027-02-10T21:30:00.000Z"),
            blockedStartsAt: new Date("2027-02-10T20:30:00.000Z"),
            blockedEndsAt: new Date("2027-02-10T21:30:00.000Z")
          }
        })
      ).rejects.toThrow();

      const adjacent = await prisma.vybeTimeSlotHold.create({
        data: {
          ...holdData,
          idempotencyKey: `adjacent-${suffix}`,
          serviceStartsAt: new Date("2027-02-10T21:00:00.000Z"),
          serviceEndsAt: new Date("2027-02-10T22:00:00.000Z"),
          blockedStartsAt: new Date("2027-02-10T21:00:00.000Z"),
          blockedEndsAt: new Date("2027-02-10T22:00:00.000Z")
        }
      });

      expect(adjacent.resourceId).toBe(resource.id);
      expect(
        await prisma.vybeTimeSlotHold.count({
          where: { occurrenceId: occurrence.id, status: "ACTIVE" }
        })
      ).toBe(2);
    });

    it(
      "rejects cross-provider and cross-offering links and enforces hold and capacity modes",
      async () => {
      const suffix = crypto.randomUUID();
      const createProvider = async (label: string) => {
        const user = await prisma.user.create({
          data: { email: `vybe-time-slot-integrity-${label}-${suffix}@events.test` }
        });
        const organization = await prisma.organization.create({
          data: {
            name: `Vybe Time Slot Integrity ${label}`,
            slug: `vybe-time-slot-integrity-${label}-${suffix}`,
            createdById: user.id
          }
        });
        const profile = await prisma.vybeProviderProfile.create({
          data: { organizationId: organization.id }
        });
        const offering = await prisma.vybeOffering.create({
          data: {
            providerProfileId: profile.id,
            category: "DINING",
            createdByUserId: user.id
          }
        });
        return { user, profile, offering };
      };

      const providerA = await createProvider("a");
      const providerB = await createProvider("b");

      await expect(
        prisma.vybeTimeSlotResourceGroup.create({
          data: {
            providerProfileId: providerA.profile.id,
            offeringId: providerB.offering.id,
            name: "Cross-provider group"
          }
        })
      ).rejects.toThrow();

      const groupA = await prisma.vybeTimeSlotResourceGroup.create({
        data: {
          providerProfileId: providerA.profile.id,
          offeringId: providerA.offering.id,
          name: "Provider A tables"
        }
      });
      const groupB = await prisma.vybeTimeSlotResourceGroup.create({
        data: {
          providerProfileId: providerB.profile.id,
          offeringId: providerB.offering.id,
          name: "Provider B tables"
        }
      });
      const resourceA = await prisma.vybeTimeSlotResource.create({
        data: {
          providerProfileId: providerA.profile.id,
          providerResourceKey: `a-table-${suffix}`,
          name: "Provider A table"
        }
      });
      const resourceB = await prisma.vybeTimeSlotResource.create({
        data: {
          providerProfileId: providerB.profile.id,
          providerResourceKey: `b-table-${suffix}`,
          name: "Provider B table"
        }
      });

      await expect(
        prisma.vybeTimeSlotResourceGroupMember.create({
          data: { resourceGroupId: groupA.id, resourceId: resourceB.id }
        })
      ).rejects.toThrow();

      const membership = await prisma.vybeTimeSlotResourceGroupMember.create({
        data: { resourceGroupId: groupA.id, resourceId: resourceA.id }
      });

      const serviceStartsAt = new Date("2027-03-10T20:00:00.000Z");
      const serviceEndsAt = new Date("2027-03-10T21:00:00.000Z");
      const occurrenceData = {
        offeringVersion: 1,
        inventoryMode: "EXCLUSIVE" as const,
        timezone: "Africa/Lagos",
        serviceStartsAt,
        serviceEndsAt,
        blockedStartsAt: serviceStartsAt,
        blockedEndsAt: serviceEndsAt
      };

      await expect(
        prisma.vybeTimeSlotOccurrence.create({
          data: {
            ...occurrenceData,
            offeringId: providerA.offering.id,
            resourceGroupId: groupB.id
          }
        })
      ).rejects.toThrow();

      const occurrence = await prisma.vybeTimeSlotOccurrence.create({
        data: {
          ...occurrenceData,
          offeringId: providerA.offering.id,
          resourceGroupId: groupA.id
        }
      });

      const holdData = {
        occurrenceId: occurrence.id,
        userId: providerA.user.id,
        status: "ACTIVE" as const,
        expiresAt: new Date("2027-03-10T19:55:00.000Z"),
        serviceStartsAt,
        serviceEndsAt,
        blockedStartsAt: serviceStartsAt,
        blockedEndsAt: serviceEndsAt
      };

      await expect(
        prisma.vybeTimeSlotHold.create({
          data: {
            ...holdData,
            idempotencyKey: `foreign-resource-${suffix}`,
            resourceId: resourceB.id
          }
        })
      ).rejects.toThrow();

      await prisma.vybeTimeSlotHold.create({
        data: {
          ...holdData,
          idempotencyKey: `valid-resource-${suffix}`,
          resourceId: resourceA.id
        }
      });

      await expect(
        prisma.vybeTimeSlotResourceGroupMember.delete({
          where: { id: membership.id }
        })
      ).rejects.toThrow();

      const capacityOccurrenceData = {
        offeringId: providerA.offering.id,
        offeringVersion: 1,
        inventoryMode: "CAPACITY" as const,
        timezone: "Africa/Lagos",
        serviceStartsAt,
        serviceEndsAt,
        blockedStartsAt: serviceStartsAt,
        blockedEndsAt: serviceEndsAt
      };

      await expect(
        prisma.vybeTimeSlotOccurrence.create({
          data: capacityOccurrenceData
        })
      ).rejects.toThrow();

      await prisma.$transaction(async (transaction) => {
        const capacityOccurrence =
          await transaction.vybeTimeSlotOccurrence.create({
            data: capacityOccurrenceData
          });
        await transaction.vybeTimeSlotCapacity.create({
          data: {
            occurrenceId: capacityOccurrence.id,
            capacity: 12
          }
        });
      });

      await expect(
        prisma.$transaction(async (transaction) => {
          const exclusiveOccurrence =
            await transaction.vybeTimeSlotOccurrence.create({
              data: {
                ...occurrenceData,
                offeringId: providerA.offering.id,
                resourceGroupId: groupA.id
              }
            });
          await transaction.vybeTimeSlotCapacity.create({
            data: {
              occurrenceId: exclusiveOccurrence.id,
              capacity: 12
            }
          });
        })
      ).rejects.toThrow();
    });
  }
);

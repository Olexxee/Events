import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
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

    it("rejects overlapping active holds for one exclusive resource and permits adjacent intervals", async () => {
      const suffix = crypto.randomUUID();
      const user = await prisma.user.create({
        data: { email: `vybe-time-slot-${suffix}@events.test` }
      });
      const organization = await prisma.organization.create({
        data: {
          name: "Vybe Time Slot Schema Provider",
          slug: `vybe-time-slot-${suffix}`,
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
  }
);

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Vybe booking schema PostgreSQL integration", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("keeps exclusive occupancy protected after a hold becomes a committed booking", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({
      data: { email: `vybe-booking-schema-${suffix}@events.test` }
    });
    const organization = await prisma.organization.create({
      data: {
        name: "Vybe Booking Schema Provider",
        slug: `vybe-booking-${suffix}`,
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
        name: "Booking schema tables"
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
    const startsAt = new Date("2027-04-12T18:00:00.000Z");
    const endsAt = new Date("2027-04-12T19:00:00.000Z");
    const occurrence = await prisma.vybeTimeSlotOccurrence.create({
      data: {
        offeringId: offering.id,
        offeringVersion: 1,
        inventoryMode: "EXCLUSIVE",
        timezone: "Africa/Lagos",
        serviceStartsAt: startsAt,
        serviceEndsAt: endsAt,
        blockedStartsAt: startsAt,
        blockedEndsAt: endsAt,
        resourceGroupId: group.id
      }
    });
    const firstHold = await prisma.vybeTimeSlotHold.create({
      data: {
        occurrenceId: occurrence.id,
        userId: user.id,
        idempotencyKey: `first-${suffix}`,
        resourceId: resource.id,
        expiresAt: new Date("2027-04-12T17:55:00.000Z"),
        serviceStartsAt: startsAt,
        serviceEndsAt: endsAt,
        blockedStartsAt: startsAt,
        blockedEndsAt: endsAt
      }
    });
    const occupancy = await prisma.vybeTimeSlotResourceOccupancy.create({
      data: {
        resourceId: resource.id,
        occurrenceId: occurrence.id,
        sourceHoldId: firstHold.id,
        blockedStartsAt: startsAt,
        blockedEndsAt: endsAt
      }
    });

    await prisma.vybeTimeSlotHold.update({
      where: { id: firstHold.id },
      data: { status: "CONVERTED" }
    });
    const booking = await prisma.vybeBooking.create({
      data: {
        publicReference: `VYB-${suffix.slice(0, 12)}`,
        customerUserId: user.id,
        providerProfileId: profile.id,
        providerOrganizationId: organization.id,
        offeringId: offering.id,
        offeringVersion: 1,
        sourceType: "EXCLUSIVE_RESOURCE",
        timeSlotHoldId: firstHold.id,
        serviceStartsAt: startsAt,
        serviceEndsAt: endsAt,
        blockedStartsAt: startsAt,
        blockedEndsAt: endsAt,
        timezone: "Africa/Lagos",
        resourceId: resource.id,
        offeringSnapshot: { title: "Dinner table" },
        priceQuoteSnapshot: {
          quoteReference: `quote-${suffix}`,
          amountMinor: 250000,
          currency: "NGN"
        },
        acceptedTermsSnapshot: { version: "terms-v1" }
      }
    });
    await prisma.vybeTimeSlotResourceOccupancy.update({
      where: { id: occupancy.id },
      data: { status: "COMMITTED", bookingId: booking.id }
    });

    await expect(
      prisma.vybeTimeSlotHold.create({
        data: {
          occurrenceId: occurrence.id,
          userId: user.id,
          idempotencyKey: `second-${suffix}`,
          resourceId: resource.id,
          expiresAt: new Date("2027-04-12T17:56:00.000Z"),
          serviceStartsAt: new Date("2027-04-12T18:30:00.000Z"),
          serviceEndsAt: new Date("2027-04-12T19:30:00.000Z"),
          blockedStartsAt: new Date("2027-04-12T18:30:00.000Z"),
          blockedEndsAt: new Date("2027-04-12T19:30:00.000Z")
        }
      })
    ).rejects.toThrow(/overlaps a committed booking occupancy/);

    expect(
      await prisma.vybeTimeSlotResourceOccupancy.findUnique({
        where: { id: occupancy.id }
      })
    ).toMatchObject({ status: "COMMITTED", bookingId: booking.id });
    await expect(
      prisma.vybeBooking.update({
        where: { id: booking.id },
        data: { offeringSnapshot: { title: "Mutated snapshot" } }
      })
    ).rejects.toThrow();
  });

  it("rejects bookings whose source hold belongs to another customer", async () => {
    const suffix = crypto.randomUUID();
    const customer = await prisma.user.create({
      data: { email: `vybe-booking-customer-${suffix}@events.test` }
    });
    const otherCustomer = await prisma.user.create({
      data: { email: `vybe-booking-other-${suffix}@events.test` }
    });
    const organization = await prisma.organization.create({
      data: {
        name: "Vybe Booking Owner Check",
        slug: `vybe-booking-owner-${suffix}`,
        createdById: customer.id
      }
    });
    const profile = await prisma.vybeProviderProfile.create({
      data: { organizationId: organization.id }
    });
    const offering = await prisma.vybeOffering.create({
      data: {
        providerProfileId: profile.id,
        category: "OTHER_SERVICES",
        createdByUserId: customer.id
      }
    });
    const pool = await prisma.vybeInventoryPool.create({
      data: { offeringId: offering.id, allocatedQuantity: 5 }
    });
    const hold = await prisma.vybeInventoryHold.create({
      data: {
        poolId: pool.id,
        userId: customer.id,
        idempotencyKey: `hold-${suffix}`,
        quantity: 1,
        offeringVersion: 1,
        status: "CONVERTED",
        expiresAt: new Date("2027-04-12T17:55:00.000Z")
      }
    });

    await expect(
      prisma.vybeBooking.create({
        data: {
          publicReference: `VYB-${suffix.slice(0, 12)}`,
          customerUserId: otherCustomer.id,
          providerProfileId: profile.id,
          providerOrganizationId: organization.id,
          offeringId: offering.id,
          offeringVersion: 1,
          sourceType: "QUANTITY_POOL",
          inventoryHoldId: hold.id,
          serviceStartsAt: null,
          serviceEndsAt: null,
          blockedStartsAt: null,
          blockedEndsAt: null,
          timezone: null,
          quantity: 1,
          offeringSnapshot: { title: "Experience" },
          priceQuoteSnapshot: {
            quoteReference: `quote-${suffix}`,
            amountMinor: 10000,
            currency: "NGN"
          },
          acceptedTermsSnapshot: { version: "terms-v1" }
        }
      })
    ).rejects.toThrow();
  });
});

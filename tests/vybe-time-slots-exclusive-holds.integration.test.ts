import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  addTimeSlotResourceGroupMember,
  createTimeSlotOccurrence,
  createTimeSlotResource,
  createTimeSlotResourceGroup,
  createTimeSlotResourceHold,
  getTimeSlotResourceAvailability,
  releaseTimeSlotHold
} from "../src/modules/vybe-time-slots/vybe-time-slots.db.js";
import { confirmVybeBookingFromHold } from "../src/modules/vybe-bookings/vybe-bookings.service.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe exclusive-resource holds PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    async function createExclusiveFixture(
      input: {
        resourceCount?: number;
        startsAt?: string;
        endsAt?: string;
        preBufferSeconds?: number;
        postBufferSeconds?: number;
      } = {}
    ) {
      const suffix = crypto.randomUUID();
      const user = await prisma.user.create({
        data: { email: `vybe-exclusive-${suffix}@events.test` }
      });
      const organization = await prisma.organization.create({
        data: {
          name: `Vybe Exclusive Provider ${suffix}`,
          slug: `vybe-exclusive-${suffix}`,
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
          category: "DINING",
          serviceDescription: "Exclusive resource integration fixture",
          supplyAuthorityStatement: "The provider controls these resources.",
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
          category: "DINING",
          status: "ACTIVE",
          locations: [{ city: "Lagos", state: "Lagos", country: "Nigeria" }],
          approvedByUserId: user.id
        }
      });
      await prisma.vybeCategoryActivation.upsert({
        where: { category: "DINING" },
        create: {
          category: "DINING",
          isActive: true,
          checklist: [],
          reason: "Exclusive resource integration fixture"
        },
        update: {
          isActive: true,
          checklist: [],
          reason: "Exclusive resource integration fixture"
        }
      });
      const offering = await prisma.vybeOffering.create({
        data: {
          providerProfileId: profile.id,
          category: "DINING",
          status: "PUBLISHED",
          currentPublishedVersion: 1,
          createdByUserId: user.id,
          versions: {
            create: {
              version: 1,
              status: "PUBLISHED",
              content: {
                title: "Exclusive resource test offering",
                location: { city: "Lagos", state: "Lagos", country: "Nigeria" },
                                cancellationPolicy: {
                  policyVersion: "provider-cancellation-v1",
                  customerCancellation: {
                    allowed: true,
                    cutoffMinutesBeforeService: 60,
                    timezone: "Africa/Lagos",
                    displayText: "Customers may cancel up to 60 minutes before service."
                  }
                },

                attributes: { category: "DINING" }
              },
              createdByUserId: user.id,
              publishedAt: new Date()
            }
          }
        }
      });
      const group = await createTimeSlotResourceGroup({
        offeringId: offering.id,
        actorUserId: user.id,
        name: `Dining resources ${suffix}`,
        supplyEvidenceReference: `provider-resource-register:${suffix}`
      });
      const resources: string[] = [];
      for (let index = 0; index < (input.resourceCount ?? 1); index += 1) {
        const resource = await createTimeSlotResource({
          offeringId: offering.id,
          actorUserId: user.id,
          providerResourceKey: `table-${index}-${suffix}`,
          name: `Table ${index + 1}`,
          supplyEvidenceReference: `provider-resource:${suffix}:${index}`
        });
        await addTimeSlotResourceGroupMember({
          groupId: group.id,
          resourceId: resource.id,
          actorUserId: user.id,
          supplyEvidenceReference: `provider-allocation:${suffix}:${index}`
        });
        resources.push(resource.id);
      }

      async function createOccurrence(
        options: {
          startsAt?: string;
          endsAt?: string;
          preBufferSeconds?: number;
          postBufferSeconds?: number;
        } = {}
      ) {
        return createTimeSlotOccurrence({
          offeringId: offering.id,
          actorUserId: user.id,
          inventoryMode: "EXCLUSIVE",
          timezone: "Africa/Lagos",
          serviceStartsAt:
            options.startsAt ?? input.startsAt ?? "2027-06-15T18:00:00+01:00",
          serviceEndsAt:
            options.endsAt ?? input.endsAt ?? "2027-06-15T19:00:00+01:00",
          preBufferSeconds:
            options.preBufferSeconds ?? input.preBufferSeconds ?? 0,
          postBufferSeconds:
            options.postBufferSeconds ?? input.postBufferSeconds ?? 0,
          resourceGroupId: group.id,
          supplyEvidenceReference: `provider-occurrence:${suffix}`
        });
      }

      return { userId: user.id, resources, createOccurrence };
    }

    it("allows only one concurrent overlapping hold when the group has one resource", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const results = await Promise.allSettled([
        createTimeSlotResourceHold({
          occurrenceId: occurrence.id,
          userId: fixture.userId,
          idempotencyKey: `exclusive-a-${crypto.randomUUID()}`
        }),
        createTimeSlotResourceHold({
          occurrenceId: occurrence.id,
          userId: fixture.userId,
          idempotencyKey: `exclusive-b-${crypto.randomUUID()}`
        })
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
    });

    it("serializes contention across different occurrences sharing one resource group", async () => {
      const fixture = await createExclusiveFixture();
      const first = await fixture.createOccurrence();
      const second = await fixture.createOccurrence();
      const results = await Promise.allSettled([
        createTimeSlotResourceHold({
          occurrenceId: first.id,
          userId: fixture.userId,
          idempotencyKey: `group-contention-a-${crypto.randomUUID()}`
        }),
        createTimeSlotResourceHold({
          occurrenceId: second.id,
          userId: fixture.userId,
          idempotencyKey: `group-contention-b-${crypto.randomUUID()}`
        })
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
    });

    it("assigns different concrete resources when a group has parallel capacity", async () => {
      const fixture = await createExclusiveFixture({ resourceCount: 2 });
      const occurrence = await fixture.createOccurrence();
      const holds = await Promise.all([
        createTimeSlotResourceHold({
          occurrenceId: occurrence.id,
          userId: fixture.userId,
          idempotencyKey: `group-a-${crypto.randomUUID()}`
        }),
        createTimeSlotResourceHold({
          occurrenceId: occurrence.id,
          userId: fixture.userId,
          idempotencyKey: `group-b-${crypto.randomUUID()}`
        })
      ]);
      expect(holds.every((hold) => hold.resourceId !== null)).toBe(true);
      expect(new Set(holds.map((hold) => hold.resourceId)).size).toBe(2);
    });

    it("returns the same concrete resource for an identical idempotent replay", async () => {
      const fixture = await createExclusiveFixture({ resourceCount: 2 });
      const occurrence = await fixture.createOccurrence();
      const input = {
        occurrenceId: occurrence.id,
        userId: fixture.userId,
        idempotencyKey: `resource-idempotent-${crypto.randomUUID()}`
      };
      const first = await createTimeSlotResourceHold(input);
      const replay = await createTimeSlotResourceHold(input);
      expect(replay.id).toBe(first.id);
      expect(replay.resourceId).toBe(first.resourceId);
      expect(
        await prisma.vybeTimeSlotHold.count({
          where: { occurrenceId: occurrence.id, userId: fixture.userId }
        })
      ).toBe(1);
    });

    it("treats adjacent half-open blocked intervals as available", async () => {
      const fixture = await createExclusiveFixture();
      const first = await fixture.createOccurrence({
        startsAt: "2027-06-15T18:00:00+01:00",
        endsAt: "2027-06-15T19:00:00+01:00"
      });
      const second = await fixture.createOccurrence({
        startsAt: "2027-06-15T19:00:00+01:00",
        endsAt: "2027-06-15T20:00:00+01:00"
      });
      const firstHold = await createTimeSlotResourceHold({
        occurrenceId: first.id,
        userId: fixture.userId,
        idempotencyKey: `adjacent-a-${crypto.randomUUID()}`
      });
      const secondHold = await createTimeSlotResourceHold({
        occurrenceId: second.id,
        userId: fixture.userId,
        idempotencyKey: `adjacent-b-${crypto.randomUUID()}`
      });
      expect(secondHold.resourceId).toBe(firstHold.resourceId);
    });

    it("rejects service intervals whose provider buffers overlap", async () => {
      const fixture = await createExclusiveFixture();
      const first = await fixture.createOccurrence({
        startsAt: "2027-06-15T18:00:00+01:00",
        endsAt: "2027-06-15T19:00:00+01:00",
        postBufferSeconds: 900
      });
      const second = await fixture.createOccurrence({
        startsAt: "2027-06-15T19:00:00+01:00",
        endsAt: "2027-06-15T20:00:00+01:00",
        preBufferSeconds: 900
      });
      await createTimeSlotResourceHold({
        occurrenceId: first.id,
        userId: fixture.userId,
        idempotencyKey: `buffer-a-${crypto.randomUUID()}`
      });
      await expect(
        createTimeSlotResourceHold({
          occurrenceId: second.id,
          userId: fixture.userId,
          idempotencyKey: `buffer-b-${crypto.randomUUID()}`
        })
      ).rejects.toMatchObject({ code: "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE" });
    });

    it("expires stale resource holds synchronously before assigning the resource again", async () => {
      const fixture = await createExclusiveFixture();
      const first = await fixture.createOccurrence();
      const second = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: first.id,
        userId: fixture.userId,
        idempotencyKey: `resource-expiry-a-${crypto.randomUUID()}`
      });
      await prisma.vybeTimeSlotHold.update({
        where: { id: hold.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      const next = await createTimeSlotResourceHold({
        occurrenceId: second.id,
        userId: fixture.userId,
        idempotencyKey: `resource-expiry-b-${crypto.randomUUID()}`
      });
      expect(next.resourceId).toBe(hold.resourceId);
      expect(
        await prisma.vybeTimeSlotHold.findUniqueOrThrow({
          where: { id: hold.id }
        })
      ).toMatchObject({ status: "EXPIRED" });
      expect(
        await prisma.auditLog.findFirst({
          where: { resourceId: hold.id, action: "vybe.time_slot_hold.expired" }
        })
      ).not.toBeNull();
    });

    it("prevents resource deactivation while an active hold depends on it", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: occurrence.id,
        userId: fixture.userId,
        idempotencyKey: `resource-deactivation-${crypto.randomUUID()}`
      });
      await expect(
        prisma.vybeTimeSlotResourceGroup.update({
          where: {
            id: (
              await prisma.vybeTimeSlotOccurrence.findUniqueOrThrow({
                where: { id: occurrence.id },
                select: { resourceGroupId: true }
              })
            ).resourceGroupId!
          },
          data: { isActive: false }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeTimeSlotResource.update({
          where: { id: hold.resourceId! },
          data: { isActive: false }
        })
      ).rejects.toThrow();
      expect(
        await prisma.vybeTimeSlotResource.findUniqueOrThrow({
          where: { id: hold.resourceId! }
        })
      ).toMatchObject({ isActive: true });
    });

    it("makes concurrent owner release idempotent and rejects other users", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: occurrence.id,
        userId: fixture.userId,
        idempotencyKey: `resource-release-${crypto.randomUUID()}`
      });
      const other = await prisma.user.create({
        data: {
          email: `vybe-exclusive-other-${crypto.randomUUID()}@events.test`
        }
      });
      await expect(
        releaseTimeSlotHold({ holdId: hold.id, userId: other.id })
      ).rejects.toMatchObject({ code: "VYBE_TIME_SLOT_HOLD_FORBIDDEN" });
      const released = await Promise.all([
        releaseTimeSlotHold({ holdId: hold.id, userId: fixture.userId }),
        releaseTimeSlotHold({ holdId: hold.id, userId: fixture.userId })
      ]);
      expect(released.every((item) => item.status === "RELEASED")).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { resourceId: hold.id, action: "vybe.time_slot_hold.released" }
        })
      ).toBe(1);
    });

    it("keeps an exclusive resource occupied across hold-to-booking conversion", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: occurrence.id,
        userId: fixture.userId,
        idempotencyKey: `booking-exclusive-${crypto.randomUUID()}`
      });
      const reference = `free-exclusive-order-${crypto.randomUUID()}`;
      const verifier = {
        verify: async () => ({
          kind: "FREE_ORDER_ACCEPTED" as const,
          reference,
          verifiedAt: new Date(),
          quote: {
            quoteReference: `quote-${reference}`,
            amountMinor: 0,
            currency: "NGN"
          }
        })
      };
      const input = {
        sourceType: "EXCLUSIVE_RESOURCE" as const,
        sourceHoldId: hold.id,
        customerUserId: fixture.userId,
        acceptedTermsSnapshot: { version: "vybe-terms-v1" }
      };
      const results = await Promise.all([
        confirmVybeBookingFromHold(input, verifier),
        confirmVybeBookingFromHold(input, verifier)
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(results[0]).toMatchObject({
        sourceType: "EXCLUSIVE_RESOURCE",
        timeSlotHoldId: hold.id,
        resourceId: hold.resourceId,
        status: "CONFIRMED"
      });
      expect(
        await prisma.vybeTimeSlotResourceOccupancy.findUniqueOrThrow({
          where: { sourceHoldId: hold.id }
        })
      ).toMatchObject({ status: "COMMITTED", bookingId: results[0].id });
      expect(
        await prisma.vybeTimeSlotHold.findUniqueOrThrow({
          where: { id: hold.id }
        })
      ).toMatchObject({ status: "CONVERTED" });
      const groupId = (
        await prisma.vybeTimeSlotOccurrence.findUniqueOrThrow({
          where: { id: occurrence.id },
          select: { resourceGroupId: true }
        })
      ).resourceGroupId!;
      const membership =
        await prisma.vybeTimeSlotResourceGroupMember.findFirstOrThrow({
          where: { resourceGroupId: groupId, resourceId: hold.resourceId! }
        });
      await expect(
        prisma.vybeTimeSlotResource.update({
          where: { id: hold.resourceId! },
          data: { isActive: false }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeTimeSlotResourceGroup.update({
          where: { id: groupId },
          data: { isActive: false }
        })
      ).rejects.toThrow();
      await expect(
        prisma.vybeTimeSlotResourceGroupMember.delete({
          where: { id: membership.id }
        })
      ).rejects.toThrow();
      expect(
        await getTimeSlotResourceAvailability(occurrence.id)
      ).toMatchObject({
        eligibleResourceCount: 1,
        availableResourceCount: 0
      });

      const overlappingOccurrence = await fixture.createOccurrence({
        startsAt: "2027-06-15T18:30:00+01:00",
        endsAt: "2027-06-15T19:30:00+01:00"
      });
      await expect(
        createTimeSlotResourceHold({
          occurrenceId: overlappingOccurrence.id,
          userId: fixture.userId,
          idempotencyKey: `overlap-after-booking-${crypto.randomUUID()}`
        })
      ).rejects.toMatchObject({
        code: "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE"
      });
      await expect(
        prisma.vybeTimeSlotHold.create({
          data: {
            occurrenceId: overlappingOccurrence.id,
            userId: fixture.userId,
            idempotencyKey: `legacy-app-over-committed-${crypto.randomUUID()}`,
            resourceId: hold.resourceId!,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            serviceStartsAt: overlappingOccurrence.serviceStartsAt,
            serviceEndsAt: overlappingOccurrence.serviceEndsAt,
            blockedStartsAt: overlappingOccurrence.blockedStartsAt,
            blockedEndsAt: overlappingOccurrence.blockedEndsAt
          }
        })
      ).rejects.toThrow();
      expect(
        await prisma.vybeTimeSlotHold.count({
          where: { occurrenceId: overlappingOccurrence.id, status: "ACTIVE" }
        })
      ).toBe(0);
    });

    it("protects active legacy holds without an occupancy row and bridges them on conversion", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const legacyHold = await prisma.vybeTimeSlotHold.create({
        data: {
          occurrenceId: occurrence.id,
          userId: fixture.userId,
          idempotencyKey: `legacy-no-occupancy-${crypto.randomUUID()}`,
          resourceId: fixture.resources[0]!,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          serviceStartsAt: occurrence.serviceStartsAt,
          serviceEndsAt: occurrence.serviceEndsAt,
          blockedStartsAt: occurrence.blockedStartsAt,
          blockedEndsAt: occurrence.blockedEndsAt
        }
      });
      expect(
        await prisma.vybeTimeSlotResourceOccupancy.findUnique({
          where: { sourceHoldId: legacyHold.id }
        })
      ).toBeNull();

      const overlappingOccurrence = await fixture.createOccurrence();
      await expect(
        createTimeSlotResourceHold({
          occurrenceId: overlappingOccurrence.id,
          userId: fixture.userId,
          idempotencyKey: `legacy-no-occupancy-contender-${crypto.randomUUID()}`
        })
      ).rejects.toMatchObject({ code: "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE" });

      const reference = `legacy-hold-order-${crypto.randomUUID()}`;
      const booking = await confirmVybeBookingFromHold(
        {
          sourceType: "EXCLUSIVE_RESOURCE",
          sourceHoldId: legacyHold.id,
          customerUserId: fixture.userId,
          acceptedTermsSnapshot: { version: "vybe-terms-v1" }
        },
        {
          verify: async () => ({
            kind: "FREE_ORDER_ACCEPTED",
            reference,
            verifiedAt: new Date(),
            quote: {
              quoteReference: `quote-${reference}`,
              amountMinor: 0,
              currency: "NGN"
            }
          })
        }
      );
      expect(
        await prisma.vybeTimeSlotResourceOccupancy.findUniqueOrThrow({
          where: { sourceHoldId: legacyHold.id }
        })
      ).toMatchObject({ status: "COMMITTED", bookingId: booking.id });
    });

    it("releases occupancy when an older hold writer only changes the source status", async () => {
      const fixture = await createExclusiveFixture();
      const firstOccurrence = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: firstOccurrence.id,
        userId: fixture.userId,
        idempotencyKey: `legacy-release-${crypto.randomUUID()}`
      });
      await prisma.vybeTimeSlotHold.update({
        where: { id: hold.id },
        data: { status: "RELEASED" }
      });
      expect(
        await prisma.vybeTimeSlotResourceOccupancy.findUniqueOrThrow({
          where: { sourceHoldId: hold.id }
        })
      ).toMatchObject({ status: "RELEASED" });

      const overlappingOccurrence = await fixture.createOccurrence();
      const replacement = await createTimeSlotResourceHold({
        occurrenceId: overlappingOccurrence.id,
        userId: fixture.userId,
        idempotencyKey: `legacy-release-replacement-${crypto.randomUUID()}`
      });
      expect(replacement.resourceId).toBe(hold.resourceId);
    });

    it("expires exclusive occupancy when its source hold expires", async () => {
      const fixture = await createExclusiveFixture();
      const occurrence = await fixture.createOccurrence();
      const hold = await createTimeSlotResourceHold({
        occurrenceId: occurrence.id,
        userId: fixture.userId,
        idempotencyKey: `exclusive-occupancy-expiry-${crypto.randomUUID()}`
      });
      await prisma.vybeTimeSlotHold.update({
        where: { id: hold.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      const nextOccurrence = await fixture.createOccurrence({
        startsAt: "2027-06-15T20:00:00+01:00",
        endsAt: "2027-06-15T21:00:00+01:00"
      });
      await createTimeSlotResourceHold({
        occurrenceId: nextOccurrence.id,
        userId: fixture.userId,
        idempotencyKey: `exclusive-occupancy-after-expiry-${crypto.randomUUID()}`
      });
      expect(
        await prisma.vybeTimeSlotResourceOccupancy.findUniqueOrThrow({
          where: { sourceHoldId: hold.id }
        })
      ).toMatchObject({ status: "EXPIRED" });
    });
  }
);

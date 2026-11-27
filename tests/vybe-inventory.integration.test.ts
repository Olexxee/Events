import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  adjustInventoryAllocation,
  createInventoryHold,
  createInventoryPool,
  getInventoryAvailability
} from "../src/modules/vybe-inventory/vybe-inventory.db.js";
import { confirmVybeBookingFromHold } from "../src/modules/vybe-bookings/vybe-bookings.service.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe quantity inventory PostgreSQL integration",
  () => {
    let ownerId: string;
    let organizationId: string;
    let offeringId: string;

    beforeAll(async () => {
      await connectDatabase();
    });

    beforeEach(async () => {
      const owner = await prisma.user.create({
        data: { email: `vybe-inventory-${crypto.randomUUID()}@events.test` }
      });
      ownerId = owner.id;
      const organization = await prisma.organization.create({
        data: {
          name: "Vybe Inventory Provider",
          slug: `vybe-inventory-${crypto.randomUUID()}`,
          createdById: ownerId,
          memberships: {
            create: { userId: ownerId, role: "OWNER", status: "ACTIVE" }
          }
        }
      });
      organizationId = organization.id;
      const profile = await prisma.vybeProviderProfile.create({
        data: { organizationId }
      });
      const application = await prisma.vybeProviderApplication.create({
        data: {
          organizationId,
          applicantUserId: ownerId,
          category: "DRINKS",
          serviceDescription: "Approved provider inventory integration fixture",
          supplyAuthorityStatement:
            "The provider controls the stock allocated to Vybe.",
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
          category: "DRINKS",
          status: "ACTIVE",
          locations: [{ city: "Lagos", state: "Lagos", country: "Nigeria" }],
          approvedByUserId: ownerId
        }
      });
      await prisma.vybeCategoryActivation.upsert({
        where: { category: "DRINKS" },
        create: {
          category: "DRINKS",
          isActive: true,
          checklist: [],
          reason: "Integration fixture"
        },
        update: {
          isActive: true,
          checklist: [],
          reason: "Integration fixture"
        }
      });
      const offering = await prisma.vybeOffering.create({
        data: {
          providerProfileId: profile.id,
          category: "DRINKS",
          status: "PUBLISHED",
          currentPublishedVersion: 1,
          createdByUserId: ownerId,
          versions: {
            create: {
              version: 1,
              status: "PUBLISHED",
              content: {
                title: "Drinks package",
                location: {
                  city: "Lagos",
                  state: "Lagos",
                  country: "Nigeria"
                },
                                cancellationPolicy: {
                  policyVersion: "provider-cancellation-v1",
                  customerCancellation: {
                    allowed: true,
                    cutoffMinutesBeforeService: null,
                    timezone: "Africa/Lagos",
                    displayText: "Customers may cancel this booking at any time."
                  }
                },

                attributes: { category: "DRINKS" }
              },
              createdByUserId: ownerId,
              publishedAt: new Date()
            }
          }
        }
      });
      offeringId = offering.id;
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    it("creates an auditable provider inventory allocation", async () => {
      const pool = await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 8,
        reason: "Initial secured inventory allocation",
        evidenceReference: "provider-inventory-register:initial-8"
      });
      expect(pool.allocatedQuantity).toBe(8);
      expect(
        await prisma.vybeInventoryAllocation.count({
          where: { poolId: pool.id }
        })
      ).toBe(1);
      expect(
        (
          await prisma.vybeInventoryAllocation.findFirstOrThrow({
            where: { poolId: pool.id }
          })
        ).evidenceReference
      ).toBe("provider-inventory-register:initial-8");
    });

    it("prevents concurrent holds from overselling inventory", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 1,
        reason: "One secured unit for concurrency test",
        evidenceReference: "provider-inventory-register:concurrency-1"
      });
      const results = await Promise.allSettled([
        createInventoryHold({
          offeringId,
          userId: ownerId,
          quantity: 1,
          idempotencyKey: crypto.randomUUID()
        }),
        createInventoryHold({
          offeringId,
          userId: ownerId,
          quantity: 1,
          idempotencyKey: crypto.randomUUID()
        })
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const availability = await getInventoryAvailability(offeringId);
      expect(availability.availableQuantity).toBe(0);
    });

    it("reuses idempotent holds and rejects changed payloads", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 3,
        reason: "Idempotency fixture allocation",
        evidenceReference: "provider-inventory-register:idempotency-3"
      });
      const idempotencyKey = crypto.randomUUID();
      const first = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey
      });
      const retry = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey
      });
      expect(retry.id).toBe(first.id);
      expect(first.expiresAt.getTime()).toBeGreaterThanOrEqual(
        Date.now() + 9 * 60 * 1000
      );
      expect(first.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 11 * 60 * 1000
      );
      await expect(
        createInventoryHold({
          offeringId,
          userId: ownerId,
          quantity: 2,
          idempotencyKey
        })
      ).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED"
      });
    });

    it("expires stale holds before allocating capacity again", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 1,
        reason: "Expiry fixture allocation",
        evidenceReference: "provider-inventory-register:expiry-1"
      });
      const old = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: crypto.randomUUID()
      });
      await prisma.vybeInventoryHold.update({
        where: { id: old.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      const next = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: crypto.randomUUID()
      });
      expect(next.status).toBe("ACTIVE");
      expect(
        await prisma.vybeInventoryHold.findUniqueOrThrow({
          where: { id: old.id }
        })
      ).toMatchObject({
        status: "EXPIRED"
      });
    });

    it("rejects allocation reductions below active holds", async () => {
      const pool = await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 2,
        reason: "Allocation reduction fixture",
        evidenceReference: "provider-inventory-register:reduction-2"
      });
      await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 2,
        idempotencyKey: crypto.randomUUID()
      });
      await expect(
        adjustInventoryAllocation({
          poolId: pool.id,
          actorUserId: ownerId,
          quantityDelta: -1,
          reason: "Attempted reduction below protected stock",
          evidenceReference: "provider-inventory-register:reduction-attempt"
        })
      ).rejects.toMatchObject({
        code: "VYBE_ALLOCATION_BELOW_COMMITMENTS"
      });
    });

    it("converts a quantity hold exactly once and returns the same booking on concurrent retries", async () => {
      const pool = await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 4,
        reason: "Booking conversion fixture",
        evidenceReference: "provider-inventory-register:booking-conversion"
      });
      const hold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 2,
        idempotencyKey: `booking-conversion-${crypto.randomUUID()}`
      });
      const reference = `free-order-${crypto.randomUUID()}`;
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
      const acceptedTermsSnapshot = {
        version: "vybe-terms-v1",
        acceptedAt: new Date().toISOString()
      };
      const input = {
        sourceType: "QUANTITY_POOL" as const,
        sourceHoldId: hold.id,
        customerUserId: ownerId,
        acceptedTermsSnapshot
      };
      const results = await Promise.all([
        confirmVybeBookingFromHold(input, verifier),
        confirmVybeBookingFromHold(input, verifier)
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(results[0]).toMatchObject({
        sourceType: "QUANTITY_POOL",
        inventoryHoldId: hold.id,
        quantity: 2,
        offeringVersion: 1,
        status: "CONFIRMED"
      });
      expect(
        await prisma.vybeInventoryHold.findUniqueOrThrow({
          where: { id: hold.id }
        })
      ).toMatchObject({ status: "CONVERTED" });
      expect(
        await prisma.vybeInventoryPool.findUniqueOrThrow({
          where: { id: pool.id }
        })
      ).toMatchObject({ committedQuantity: 2 });
      expect(
        await prisma.vybeBooking.count({
          where: { inventoryHoldId: hold.id }
        })
      ).toBe(1);
      expect(
        await prisma.vybeBookingStatusHistory.count({
          where: { bookingId: results[0].id, toStatus: "CONFIRMED" }
        })
      ).toBe(1);
      expect(
        await prisma.outboxMessage.count({
          where: {
            aggregateId: results[0].id,
            eventType: "vybe.booking.confirmed.v1"
          }
        })
      ).toBe(1);
      await expect(
        confirmVybeBookingFromHold(
          {
            ...input,
            acceptedTermsSnapshot: { version: "different-terms-v2" }
          },
          verifier
        )
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("rolls back hold conversion and inventory commitment if booking creation fails", async () => {
      const pool = await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 3,
        reason: "Booking rollback fixture",
        evidenceReference: "provider-inventory-register:booking-rollback"
      });
      const firstHold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: `booking-rollback-first-${crypto.randomUUID()}`
      });
      const secondHold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: `booking-rollback-second-${crypto.randomUUID()}`
      });
      const reference = `rollback-order-${crypto.randomUUID()}`;
      const orderItemReference = `commerce-item-${crypto.randomUUID()}`;
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
      const base = {
        sourceType: "QUANTITY_POOL" as const,
        customerUserId: ownerId,
        acceptedTermsSnapshot: { version: "vybe-terms-v1" },
        externalOrderItemReference: orderItemReference
      };
      await confirmVybeBookingFromHold(
        { ...base, sourceHoldId: firstHold.id },
        verifier
      );
      await expect(
        confirmVybeBookingFromHold(
          { ...base, sourceHoldId: secondHold.id },
          verifier
        )
      ).rejects.toThrow();
      expect(
        await prisma.vybeInventoryHold.findUniqueOrThrow({
          where: { id: secondHold.id }
        })
      ).toMatchObject({ status: "ACTIVE" });
      expect(
        await prisma.vybeInventoryPool.findUniqueOrThrow({
          where: { id: pool.id }
        })
      ).toMatchObject({ committedQuantity: 1 });
      expect(
        await prisma.vybeBooking.count({
          where: { inventoryHoldId: secondHold.id }
        })
      ).toBe(0);
    });

    it("accepts a paid booking only with positive server-verified confirmation evidence", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 1,
        reason: "Paid confirmation contract fixture",
        evidenceReference: "provider-inventory-register:paid-confirmation"
      });
      const hold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: `paid-booking-${crypto.randomUUID()}`
      });
      const verifier = {
        verify: async () => ({
          kind: "PAYMENT_VERIFIED" as const,
          reference: `verified-payment-${crypto.randomUUID()}`,
          verifiedAt: new Date(),
          quote: {
            quoteReference: `paid-quote-${crypto.randomUUID()}`,
            amountMinor: 750000,
            currency: "NGN"
          }
        })
      };
      const booking = await confirmVybeBookingFromHold(
        {
          sourceType: "QUANTITY_POOL",
          sourceHoldId: hold.id,
          customerUserId: ownerId,
          acceptedTermsSnapshot: { version: "vybe-terms-v1" }
        },
        verifier
      );
      expect(booking.status).toBe("CONFIRMED");
      expect(booking.priceQuoteSnapshot).toMatchObject({
        amountMinor: 750000,
        currency: "NGN",
        confirmation: { kind: "PAYMENT_VERIFIED" }
      });
    });

    it("rejects paid confirmation evidence for a zero-value quote", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 1,
        reason: "Invalid paid confirmation fixture",
        evidenceReference:
          "provider-inventory-register:invalid-paid-confirmation"
      });
      const hold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: `invalid-paid-booking-${crypto.randomUUID()}`
      });
      const verifier = {
        verify: async () => ({
          kind: "PAYMENT_VERIFIED" as const,
          reference: `invalid-payment-${crypto.randomUUID()}`,
          verifiedAt: new Date(),
          quote: {
            quoteReference: `zero-paid-quote-${crypto.randomUUID()}`,
            amountMinor: 0,
            currency: "NGN"
          }
        })
      };
      await expect(
        confirmVybeBookingFromHold(
          {
            sourceType: "QUANTITY_POOL",
            sourceHoldId: hold.id,
            customerUserId: ownerId,
            acceptedTermsSnapshot: { version: "vybe-terms-v1" }
          },
          verifier
        )
      ).rejects.toMatchObject({
        code: "VYBE_BOOKING_CONFIRMATION_INVALID"
      });
      expect(
        await prisma.vybeInventoryHold.findUniqueOrThrow({
          where: { id: hold.id }
        })
      ).toMatchObject({ status: "ACTIVE" });
      expect(
        await prisma.vybeBooking.count({
          where: { inventoryHoldId: hold.id }
        })
      ).toBe(0);
    });

    it("expires a quantity hold instead of confirming it after its deadline", async () => {
      await createInventoryPool({
        organizationId,
        offeringId,
        actorUserId: ownerId,
        allocatedQuantity: 1,
        reason: "Expired booking fixture",
        evidenceReference: "provider-inventory-register:booking-expiry"
      });
      const hold = await createInventoryHold({
        offeringId,
        userId: ownerId,
        quantity: 1,
        idempotencyKey: `booking-expiry-${crypto.randomUUID()}`
      });
      await prisma.vybeInventoryHold.update({
        where: { id: hold.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      const verifier = {
        verify: async () => ({
          kind: "FREE_ORDER_ACCEPTED" as const,
          reference: `expired-order-${crypto.randomUUID()}`,
          verifiedAt: new Date(),
          quote: {
            quoteReference: `expired-quote-${crypto.randomUUID()}`,
            amountMinor: 0,
            currency: "NGN"
          }
        })
      };
      await expect(
        confirmVybeBookingFromHold(
          {
            sourceType: "QUANTITY_POOL",
            sourceHoldId: hold.id,
            customerUserId: ownerId,
            acceptedTermsSnapshot: { version: "vybe-terms-v1" }
          },
          verifier
        )
      ).rejects.toMatchObject({ code: "VYBE_BOOKING_HOLD_EXPIRED" });
      expect(
        await prisma.vybeInventoryHold.findUniqueOrThrow({
          where: { id: hold.id }
        })
      ).toMatchObject({ status: "EXPIRED" });
      expect(
        await prisma.vybeBooking.count({
          where: { inventoryHoldId: hold.id }
        })
      ).toBe(0);
      expect(
        await prisma.vybeInventoryPool.findUniqueOrThrow({
          where: { offeringId }
        })
      ).toMatchObject({ committedQuantity: 0 });
    });
  }
);

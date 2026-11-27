import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  getMyVybeBooking,
  listMyVybeBookings
} from "../src/modules/vybe-bookings/vybe-bookings.reads.service.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe customer booking reads PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    it("scopes list and detail to the authenticated customer and returns a safe DTO", async () => {
      const suffix = crypto.randomUUID();
      const customer = await prisma.user.create({
        data: { email: `vybe-booking-read-${suffix}@events.test` }
      });
      const otherCustomer = await prisma.user.create({
        data: { email: `vybe-booking-read-other-${suffix}@events.test` }
      });
      const organization = await prisma.organization.create({
        data: {
          name: "Vybe Booking Read Provider",
          slug: `vybe-booking-read-${suffix}`,
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
        data: {
          offeringId: offering.id,
          allocatedQuantity: 2,
          committedQuantity: 1
        }
      });
      const hold = await prisma.vybeInventoryHold.create({
        data: {
          poolId: pool.id,
          userId: customer.id,
          idempotencyKey: `booking-read-${suffix}`,
          quantity: 1,
          offeringVersion: 1,
          status: "CONVERTED",
          expiresAt: new Date(Date.now() + 60_000)
        }
      });
      const booking = await prisma.vybeBooking.create({
        data: {
          publicReference: `VYB-${suffix.slice(0, 20)}`,
          customerUserId: customer.id,
          providerProfileId: profile.id,
          providerOrganizationId: organization.id,
          offeringId: offering.id,
          offeringVersion: 1,
          sourceType: "QUANTITY_POOL",
          inventoryHoldId: hold.id,
          status: "CONFIRMED",
          serviceStartsAt: null,
          serviceEndsAt: null,
          blockedStartsAt: null,
          blockedEndsAt: null,
          timezone: null,
          quantity: 1,
          offeringSnapshot: {
            schemaVersion: 1,
            content: {
              title: "Private dining experience",
              description: "A customer-visible description",
              category: "DINING",
              privateVenueAddress: "must not be returned"
            }
          },
          priceQuoteSnapshot: {
            schemaVersion: 1,
            quoteReference: `quote-${suffix}`,
            amountMinor: 250000,
            currency: "NGN",
            confirmation: { reference: "internal-payment-evidence" }
          },
          acceptedTermsSnapshot: {
          version: "terms-v1",
          cancellationPolicy: {
            policyVersion: "provider-cancellation-v1",
            acceptedAt: "2026-11-27T10:00:00.000Z",
            customerCancellation: {
              allowed: true,
              cutoffAt: null,
              timezone: "Africa/Lagos",
              displayText: "Customers may cancel this booking at any time."
            }
          }
        }
        }
      });

      const own = await listMyVybeBookings({
        customerUserId: customer.id,
        limit: 10
      });
      const foreign = await listMyVybeBookings({
        customerUserId: otherCustomer.id,
        limit: 10
      });
      expect(own.bookings).toHaveLength(1);
      expect(own.bookings[0]).toMatchObject({
        publicReference: booking.publicReference,
        status: "CONFIRMED",
        offering: {
          title: "Private dining experience",
          category: "DINING"
        },
        price: { amountMinor: 250000, currency: "NGN" },
        acceptedTerms: {
          cancellationPolicy: {
            policyVersion: "provider-cancellation-v1",
            acceptedAt: "2026-11-27T10:00:00.000Z",
            customerCancellation: {
              allowed: true,
              cutoffAt: null,
              timezone: "Africa/Lagos"
            }
          }
        }
      });
      expect(foreign.bookings).toHaveLength(0);
      expect(JSON.stringify(own.bookings[0])).not.toContain(
        "privateVenueAddress"
      );
      expect(JSON.stringify(own.bookings[0])).not.toContain(
        "internal-payment-evidence"
      );
      expect(JSON.stringify(own.bookings[0])).not.toContain(customer.id);

      await expect(
        getMyVybeBooking({
          bookingId: booking.id,
          customerUserId: otherCustomer.id
        })
      ).rejects.toMatchObject({
        code: "VYBE_BOOKING_NOT_FOUND",
        statusCode: 404
      });

      const detail = await getMyVybeBooking({
        bookingId: booking.id,
        customerUserId: customer.id
      });
      expect(detail.publicReference).toBe(booking.publicReference);
    });
  }
);

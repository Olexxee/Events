import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  createTimeSlotCapacityHold,
  createTimeSlotOccurrence,
  getTimeSlotCapacityAvailability,
  releaseTimeSlotCapacityHold
} from "../src/modules/vybe-time-slots/vybe-time-slots.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)(
  "Vybe time-slot capacity holds PostgreSQL integration",
  () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createCapacityFixture(capacity: number) {
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({
      data: { email: `vybe-time-slot-hold-${suffix}@events.test` }
    });
    const organization = await prisma.organization.create({
      data: {
        name: `Vybe Time Slot Hold Provider ${suffix}`,
        slug: `vybe-time-slot-hold-${suffix}`,
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
        category: "DRINKS",
        serviceDescription: "Capacity hold integration fixture",
        supplyAuthorityStatement: "The provider controls the supply.",
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
        approvedByUserId: user.id
      }
    });
    await prisma.vybeCategoryActivation.upsert({
      where: { category: "DRINKS" },
      create: {
        category: "DRINKS",
        isActive: true,
        checklist: [],
        reason: "Time-slot capacity hold integration fixture"
      },
      update: {
        isActive: true,
        checklist: [],
        reason: "Time-slot capacity hold integration fixture"
      }
    });
    const offering = await prisma.vybeOffering.create({
      data: {
        providerProfileId: profile.id,
        category: "DRINKS",
        status: "PUBLISHED",
        currentPublishedVersion: 1,
        createdByUserId: user.id,
        versions: {
          create: {
            version: 1,
            status: "PUBLISHED",
            content: {
              title: "Capacity hold test offering",
              location: { city: "Lagos", state: "Lagos", country: "Nigeria" },
              attributes: { category: "DRINKS" }
            },
            createdByUserId: user.id,
            publishedAt: new Date()
          }
        }
      }
    });
    const occurrence = await createTimeSlotOccurrence({
      offeringId: offering.id,
      actorUserId: user.id,
      inventoryMode: "CAPACITY",
      timezone: "Africa/Lagos",
      serviceStartsAt: "2027-06-15T18:00:00+01:00",
      serviceEndsAt: "2027-06-15T19:00:00+01:00",
      preBufferSeconds: 300,
      postBufferSeconds: 600,
      capacity,
      supplyEvidenceReference: `provider-capacity-register:${suffix}`
    });
    return { userId: user.id, occurrenceId: occurrence.id };
  }

  it(
    "serializes competing final-unit holds so capacity cannot be oversold",
    async () => {
    const fixture = await createCapacityFixture(1);
    const results = await Promise.allSettled([
      createTimeSlotCapacityHold({
        ...fixture,
        quantity: 1,
        idempotencyKey: `final-unit-a-${crypto.randomUUID()}`
      }),
      createTimeSlotCapacityHold({
        ...fixture,
        quantity: 1,
        idempotencyKey: `final-unit-b-${crypto.randomUUID()}`
      })
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const availability = await getTimeSlotCapacityAvailability(
      fixture.occurrenceId
    );
    expect(availability.availableQuantity).toBe(0);
    expect(availability.heldQuantity).toBe(1);
  });

  it(
    "prevents concurrent multi-unit requests from exceeding total capacity",
    async () => {
    const fixture = await createCapacityFixture(3);
    const results = await Promise.allSettled([
      createTimeSlotCapacityHold({
        ...fixture,
        quantity: 2,
        idempotencyKey: `multi-unit-a-${crypto.randomUUID()}`
      }),
      createTimeSlotCapacityHold({
        ...fixture,
        quantity: 2,
        idempotencyKey: `multi-unit-b-${crypto.randomUUID()}`
      })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (await getTimeSlotCapacityAvailability(fixture.occurrenceId)).heldQuantity
    ).toBe(2);
  });

  it(
    "returns the original hold for an identical idempotent replay",
    async () => {
    const fixture = await createCapacityFixture(5);
    const input = {
      ...fixture,
      quantity: 2,
      idempotencyKey: `idempotent-${crypto.randomUUID()}`
    };
    const first = await createTimeSlotCapacityHold(input);
    const replay = await createTimeSlotCapacityHold(input);
    expect(replay.id).toBe(first.id);
    expect(await prisma.vybeTimeSlotHold.count({
      where: { occurrenceId: fixture.occurrenceId, userId: fixture.userId }
    })).toBe(1);
  });

  it("rejects reuse of an idempotency key with a changed payload", async () => {
    const fixture = await createCapacityFixture(5);
    const idempotencyKey = `changed-payload-${crypto.randomUUID()}`;
    await createTimeSlotCapacityHold({
      ...fixture,
      quantity: 1,
      idempotencyKey
    });
    await expect(
      createTimeSlotCapacityHold({ ...fixture, quantity: 2, idempotencyKey })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it(
    "expires stale holds synchronously before allocating capacity again",
    async () => {
    const fixture = await createCapacityFixture(1);
    const hold = await createTimeSlotCapacityHold({
      ...fixture,
      quantity: 1,
      idempotencyKey: `expiry-${crypto.randomUUID()}`
    });
    await prisma.vybeTimeSlotHold.update({
      where: { id: hold.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const next = await createTimeSlotCapacityHold({
      ...fixture,
      quantity: 1,
      idempotencyKey: `after-expiry-${crypto.randomUUID()}`
    });
    expect(next.status).toBe("ACTIVE");
    expect(await prisma.vybeTimeSlotHold.findUniqueOrThrow({
      where: { id: hold.id }
    })).toMatchObject({ status: "EXPIRED" });
    expect(await prisma.auditLog.findFirst({
      where: {
        resourceId: hold.id,
        action: "vybe.time_slot_hold.expired"
      }
    })).not.toBeNull();
  });

  it(
    "makes concurrent release retries a single terminal transition",
    async () => {
    const fixture = await createCapacityFixture(2);
    const hold = await createTimeSlotCapacityHold({
      ...fixture,
      quantity: 1,
      idempotencyKey: `release-race-${crypto.randomUUID()}`
    });
    const results = await Promise.all([
      releaseTimeSlotCapacityHold({ holdId: hold.id, userId: fixture.userId }),
      releaseTimeSlotCapacityHold({ holdId: hold.id, userId: fixture.userId })
    ]);
    expect(results.every((result) => result.status === "RELEASED")).toBe(true);
    expect(await prisma.auditLog.count({
      where: { resourceId: hold.id, action: "vybe.time_slot_hold.released" }
    })).toBe(1);
    expect(await prisma.outboxMessage.count({
      where: {
        aggregateId: fixture.occurrenceId,
        eventType: "vybe.time_slot_hold.released.v1"
      }
    })).toBe(1);
  });

  it("allows only the hold owner to release capacity", async () => {
    const fixture = await createCapacityFixture(2);
    const other = await prisma.user.create({
      data: { email: `vybe-time-slot-other-${crypto.randomUUID()}@events.test` }
    });
    const hold = await createTimeSlotCapacityHold({
      ...fixture,
      quantity: 1,
      idempotencyKey: `owner-release-${crypto.randomUUID()}`
    });
    await expect(
      releaseTimeSlotCapacityHold({ holdId: hold.id, userId: other.id })
    ).rejects.toMatchObject({ code: "VYBE_TIME_SLOT_HOLD_FORBIDDEN" });
    const released = await releaseTimeSlotCapacityHold({
      holdId: hold.id,
      userId: fixture.userId
    });
    expect(released.status).toBe("RELEASED");
    expect(
      (await getTimeSlotCapacityAvailability(fixture.occurrenceId)).availableQuantity
    ).toBe(2);
  });
});

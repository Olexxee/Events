import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import { createDraft, publishDraft } from "../src/modules/events/events.db.js";
import {
  createHold,
  createTicketType
} from "../src/modules/ticketing/ticketing.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Ticketing inventory PostgreSQL integration", () => {
  let ownerId: string;
  let organizationId: string;
  let categoryId: string;
  let eventId: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await prisma.ticketHoldLine.deleteMany();
    await prisma.ticketHold.deleteMany();
    await prisma.ticketTypeVersion.deleteMany();
    await prisma.ticketType.deleteMany();
    await prisma.eventAccessHold.deleteMany();
    await prisma.eventAccessGrant.deleteMany();
    await prisma.eventAccessRequest.deleteMany();
    await prisma.eventInvitation.deleteMany();
    await prisma.eventRevision.deleteMany();
    await prisma.eventVenue.deleteMany();
    await prisma.eventSchedule.deleteMany();
    await prisma.event.deleteMany();
    await prisma.organizerApplication.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordCredential.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();

    const owner = await prisma.user.create({
      data: { email: `ticket-owner-${crypto.randomUUID()}@events.test` }
    });
    ownerId = owner.id;
    const organization = await prisma.organization.create({
      data: {
        name: "Ticketing Integration Organizer",
        slug: `ticketing-${crypto.randomUUID()}`,
        createdById: ownerId,
        memberships: {
          create: { userId: ownerId, role: "OWNER", status: "ACTIVE" }
        }
      }
    });
    organizationId = organization.id;
    categoryId = (
      await prisma.eventCategory.findUniqueOrThrow({
        where: { slug: "music" },
        select: { id: true }
      })
    ).id;

    const event = await createDraft({
      organizationId,
      actorUserId: ownerId,
      categoryId,
      title: "Ticketing Inventory Test",
      slug: `ticketing-test-${crypto.randomUUID()}`,
      summary: "An integration event for inventory and hold verification.",
      description:
        "A PostgreSQL-backed event used to test ticket inventory and holds.",
      format: "ONLINE",
      visibility: "PUBLIC",
      accessPolicy: "OPEN",
      timezone: "Africa/Lagos",
      schedules: [
        { startsAt: "2027-04-10T09:00:00Z", endsAt: "2027-04-10T17:00:00Z" }
      ]
    });
    eventId = event.id;
    await prisma.organizerApplication.create({
      data: {
        organizationId,
        applicantUserId: ownerId,
        status: "APPROVED",
        applicationMessage: "Integration fixture approval",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(),
        reviewedByUserId: ownerId
      }
    });
    await publishDraft(eventId, ownerId);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function ticketType(capacity: number, name = "General Admission") {
    return createTicketType({
      eventId,
      actorUserId: ownerId,
      name,
      priceMinor: "250000",
      currency: "NGN",
      benefits: [],
      capacity,
      minPerOrder: 1,
      maxPerOrder: 10,
      transferable: false
    });
  }

  it("creates an immutable version-one price and benefit snapshot", async () => {
    const type = await ticketType(10);
    expect(type.currentVersion).toMatchObject({
      version: 1,
      unitPriceMinor: "250000",
      currency: "NGN",
      benefits: []
    });
    expect(type.capacity).toBe(10);
    expect(
      await prisma.ticketTypeVersion.count({ where: { ticketTypeId: type.id } })
    ).toBe(1);
  });

  it("creates a multi-ticket-type hold atomically with a ten-minute expiry", async () => {
    const first = await ticketType(5, "General");
    const second = await ticketType(5, "VIP");
    const before = Date.now();
    const hold = await createHold({
      eventId,
      userId: ownerId,
      idempotencyKey: crypto.randomUUID(),
      items: [
        { ticketTypeId: first.id, quantity: 2 },
        { ticketTypeId: second.id, quantity: 1 }
      ]
    });
    expect(hold.lines).toHaveLength(2);
    expect(hold.lines.map((line) => line.quantity).sort()).toEqual([1, 2]);
    expect(hold.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 9 * 60 * 1000
    );
    expect(hold.expiresAt.getTime()).toBeLessThanOrEqual(
      before + 11 * 60 * 1000
    );
  });

  it("does not oversell when concurrent holds compete for the final unit", async () => {
    const type = await ticketType(1);
    const attempts = await Promise.allSettled([
      createHold({
        eventId,
        userId: ownerId,
        idempotencyKey: crypto.randomUUID(),
        items: [{ ticketTypeId: type.id, quantity: 1 }]
      }),
      createHold({
        eventId,
        userId: ownerId,
        idempotencyKey: crypto.randomUUID(),
        items: [{ ticketTypeId: type.id, quantity: 1 }]
      })
    ]);
    const successful = attempts.filter((item) => item.status === "fulfilled");
    expect(successful).toHaveLength(1);
    const active = await prisma.ticketHoldLine.aggregate({
      where: {
        ticketTypeId: type.id,
        hold: { status: "ACTIVE", expiresAt: { gt: new Date() } }
      },
      _sum: { quantity: true }
    });
    expect(active._sum.quantity).toBeLessThanOrEqual(1);
  });

  it("expires stale holds synchronously before allocating new inventory", async () => {
    const type = await ticketType(1);
    const old = await createHold({
      eventId,
      userId: ownerId,
      idempotencyKey: crypto.randomUUID(),
      items: [{ ticketTypeId: type.id, quantity: 1 }]
    });
    await prisma.ticketHold.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const next = await createHold({
      eventId,
      userId: ownerId,
      idempotencyKey: crypto.randomUUID(),
      items: [{ ticketTypeId: type.id, quantity: 1 }]
    });
    expect(next.status).toBe("ACTIVE");
    expect(
      await prisma.ticketHold.findUniqueOrThrow({ where: { id: old.id } })
    ).toMatchObject({
      status: "EXPIRED"
    });
  });
});

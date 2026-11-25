import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

const prisma = getPrismaClient();
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(code, message, status);
};
const holdLifetimeMs = 10 * 60 * 1000;

async function assertEventManager(
  tx: Prisma.TransactionClient,
  eventId: string,
  userId: string
) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      moderationStatus: true,
      organization: { select: { status: true } }
    }
  });
  if (!event) throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
  const membership = await tx.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId: event.organizationId, userId } },
    select: { role: true, status: true }
  });
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    !["OWNER", "ADMIN"].includes(membership.role) ||
    event.organization.status !== "ACTIVE"
  ) fail("TICKETING_FORBIDDEN", "Active organization owners or admins may manage ticket types", 403);
  const approval = await tx.organizerApplication.findFirst({
    where: { organizationId: event.organizationId, status: "APPROVED" },
    select: { id: true }
  });
  if (!approval) fail("ORGANIZER_APPROVAL_REQUIRED", "Organizer approval is required", 403);
  if (event.status !== "PUBLISHED" || event.moderationStatus !== "CLEAR")
    fail("EVENT_NOT_SELLABLE", "Ticket types can only be managed for a published, unrestricted event");
  return event;
}

function asPublicVersion(version: {
  version: number; name: string; description: string | null; admissionClass: string | null;
  unitPriceMinor: bigint; currency: string; benefits: Prisma.JsonValue; transferable: boolean;
}) {
  return { ...version, unitPriceMinor: version.unitPriceMinor.toString() };
}

export async function createTicketType(input: {
  eventId: string; actorUserId: string; name: string; description?: string;
  admissionClass?: string; priceMinor: string; currency: "NGN"; benefits: Prisma.InputJsonValue;
  capacity: number; salesStartsAt?: string; salesEndsAt?: string;
  minPerOrder: number; maxPerOrder: number; transferable: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await assertEventManager(tx, input.eventId, input.actorUserId);
    const price = BigInt(input.priceMinor);
    if (price < 0n) fail("TICKET_PRICE_INVALID", "Ticket price cannot be negative", 400);
    const ticketType = await tx.ticketType.create({
      data: {
        eventId: input.eventId,
        createdByUserId: input.actorUserId,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.admissionClass ? { admissionClass: input.admissionClass } : {}),
        capacity: input.capacity,
        minPerOrder: input.minPerOrder,
        maxPerOrder: input.maxPerOrder,
        ...(input.salesStartsAt ? { salesStartsAt: new Date(input.salesStartsAt) } : {}),
        ...(input.salesEndsAt ? { salesEndsAt: new Date(input.salesEndsAt) } : {}),
        versions: {
          create: {
            version: 1,
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
            ...(input.admissionClass ? { admissionClass: input.admissionClass } : {}),
            unitPriceMinor: price,
            currency: input.currency,
            benefits: input.benefits,
            transferable: input.transferable,
            createdByUserId: input.actorUserId
          }
        }
      },
      include: { versions: { where: { version: 1 } } }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorUserId, actorType: "user", action: "ticketing.ticket_type.created",
        resourceType: "ticket_type", resourceId: ticketType.id,
        metadata: { eventId: input.eventId, capacity: input.capacity, currency: input.currency }
      }
    });
    await tx.outboxMessage.create({
      data: {
        aggregateType: "ticket_type", aggregateId: ticketType.id, eventType: "TicketTypeCreated",
        deduplicationKey: `ticket-type.created:${ticketType.id}`,
        payload: { eventId: input.eventId, ticketTypeId: ticketType.id, version: 1 }
      }
    });
    const { versions, ...rest } = ticketType;
    return { ...rest, currentVersion: asPublicVersion(versions[0]!) };
  });
}

export async function listTicketTypes(eventId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true, status: true, visibility: true, accessPolicy: true, moderationStatus: true,
        organization: { select: { status: true } },
        accessHolds: { where: { releasedAt: null }, take: 1 }
      }
    });
    if (!event || event.status === "DRAFT")
      throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
    if (
      event.status !== "PUBLISHED" ||
      event.moderationStatus !== "CLEAR" ||
      event.organization.status !== "ACTIVE" ||
      event.accessHolds.length > 0
    ) fail("EVENT_NOT_SELLABLE", "Ticket sales are not available");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== "ACTIVE") fail("ACCOUNT_INACTIVE", "An active account is required", 403);
    if (event.accessPolicy !== "OPEN" || event.visibility === "INVITATION_ONLY") {
      const grant = await tx.eventAccessGrant.findFirst({
        where: {
          eventId, userId, status: "ACTIVE", canCheckout: true, expiresAt: { gt: new Date() },
          ...(event.accessPolicy === "INVITATION_ONLY" ? { source: { in: ["INVITATION", "PLATFORM"] } } : {})
        },
        select: { id: true, source: true }
      });
      if (!grant) fail("EVENT_CHECKOUT_ACCESS_REQUIRED", "Approved event access is required", 403);
      if (event.accessPolicy === "APPROVAL_REQUIRED" && grant.source === "INVITATION") {
        const request = await tx.eventAccessRequest.findFirst({
          where: { eventId, requesterUserId: userId, status: "APPROVED" },
          select: { id: true }
        });
        if (!request) fail("EVENT_CHECKOUT_ACCESS_REQUIRED", "Organizer checkout approval is required", 403);
      }
    }
    const now = new Date();
    const types = await tx.ticketType.findMany({
      where: { eventId, status: "ACTIVE" },
      include: { versions: true },
      orderBy: { createdAt: "asc" }
    });
    const held = await tx.ticketHoldLine.groupBy({
      by: ["ticketTypeId"],
      where: { ticketTypeId: { in: types.map((type) => type.id) }, hold: { status: "ACTIVE", expiresAt: { gt: now } } },
      _sum: { quantity: true }
    });
    const heldByType = new Map(held.map((row) => [row.ticketTypeId, row._sum.quantity ?? 0]));
    return types
      .filter((type) =>
        (!type.salesStartsAt || type.salesStartsAt <= now) &&
        (!type.salesEndsAt || type.salesEndsAt > now) &&
        type.versions.find((version) => version.version === type.currentVersion)
      )
      .map((type) => {
        const version = type.versions.find((item) => item.version === type.currentVersion)!;
        const available = Math.max(0, type.capacity - type.issuedQuantity - (heldByType.get(type.id) ?? 0));
        return {
          id: type.id, name: type.name, description: type.description,
          admissionClass: type.admissionClass, capacity: type.capacity,
          availableQuantity: available, minPerOrder: type.minPerOrder, maxPerOrder: type.maxPerOrder,
          salesStartsAt: type.salesStartsAt, salesEndsAt: type.salesEndsAt,
          currentVersion: asPublicVersion(version)
        };
      });
  });
}

export async function createHold(input: {
  eventId: string; userId: string; idempotencyKey: string; checkoutReference?: string;
  items: { ticketTypeId: string; quantity: number }[];
}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.ticketHold.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      include: { lines: true }
    });
    if (existing) {
      const same = existing.eventId === input.eventId &&
        existing.lines.length === input.items.length &&
        input.items.every((item) => existing.lines.some((line) => line.ticketTypeId === item.ticketTypeId && line.quantity === item.quantity));
      if (!same) fail("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different hold");
      if (existing.status === "ACTIVE" && existing.expiresAt > now) return existing;
      fail("HOLD_NO_LONGER_ACTIVE", "This idempotent hold has expired or been released");
    }
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user || user.status !== "ACTIVE") fail("ACCOUNT_INACTIVE", "An active account is required", 403);
    const ids = input.items.map((item) => item.ticketTypeId).sort();
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ticket_types WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const types = await tx.ticketType.findMany({
      where: { id: { in: ids }, eventId: input.eventId, status: "ACTIVE" },
      include: { event: { include: { organization: true, schedules: true, accessHolds: { where: { releasedAt: null }, take: 1 } } }, versions: true }
    });
    if (types.length !== ids.length) fail("TICKET_TYPE_UNAVAILABLE", "One or more ticket types are unavailable", 404);
    const event = types[0]!.event;
    if (
      event.status !== "PUBLISHED" || event.moderationStatus !== "CLEAR" ||
      event.organization.status !== "ACTIVE" || event.accessHolds.length > 0
    ) fail("EVENT_NOT_SELLABLE", "Ticket sales are not available");
    const eventEndsAt = event.schedules.reduce<Date | null>((latest, schedule) =>
      !latest || schedule.endsAt > latest ? schedule.endsAt : latest, null);
    if (!eventEndsAt || eventEndsAt <= now) fail("EVENT_ADMISSION_CLOSED", "The event admission window has ended");
    if (event.accessPolicy !== "OPEN" || event.visibility === "INVITATION_ONLY") {
      const grant = await tx.eventAccessGrant.findFirst({
        where: {
          eventId: input.eventId, userId: input.userId, status: "ACTIVE", canCheckout: true,
          expiresAt: { gt: now },
          ...(event.visibility === "INVITATION_ONLY" || event.accessPolicy === "INVITATION_ONLY"
            ? { source: { in: ["INVITATION", "PLATFORM"] } } : {})
        },
        select: { source: true }
      });
      if (!grant) fail("EVENT_CHECKOUT_ACCESS_REQUIRED", "Approved event access is required", 403);
      if (event.accessPolicy === "APPROVAL_REQUIRED" && grant.source === "INVITATION") {
        const request = await tx.eventAccessRequest.findFirst({
          where: { eventId: input.eventId, requesterUserId: input.userId, status: "APPROVED" },
          select: { id: true }
        });
        if (!request) fail("EVENT_CHECKOUT_ACCESS_REQUIRED", "Organizer checkout approval is required", 403);
      }
    }
    await tx.ticketHold.updateMany({
      where: { eventId: input.eventId, status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "EXPIRED" }
    });
    const held = await tx.ticketHoldLine.groupBy({
      by: ["ticketTypeId"],
      where: { ticketTypeId: { in: ids }, hold: { status: "ACTIVE", expiresAt: { gt: now } } },
      _sum: { quantity: true }
    });
    const heldByType = new Map(held.map((row) => [row.ticketTypeId, row._sum.quantity ?? 0]));
    const lines = input.items.map((item) => {
      const type = types.find((candidate) => candidate.id === item.ticketTypeId)!;
      const version = type.versions.find((candidate) => candidate.version === type.currentVersion);
      if (!version) fail("TICKET_VERSION_MISSING", "Ticket price version is unavailable", 500);
      if (
        type.salesStartsAt && type.salesStartsAt > now ||
        type.salesEndsAt && type.salesEndsAt <= now
      ) fail("TICKET_SALES_CLOSED", "Ticket sales are not currently open");
      if (item.quantity < type.minPerOrder || item.quantity > type.maxPerOrder)
        fail("TICKET_QUANTITY_INVALID", "Requested quantity is outside this ticket type's per-order limits", 400);
      const available = type.capacity - type.issuedQuantity - (heldByType.get(type.id) ?? 0);
      if (item.quantity > available) fail("TICKET_INVENTORY_INSUFFICIENT", "There is not enough ticket inventory available");
      return {
        ticketTypeId: type.id, quantity: item.quantity, typeVersion: version.version,
        unitPriceMinor: version.unitPriceMinor, currency: version.currency
      };
    });
    const hold = await tx.ticketHold.create({
      data: {
        eventId: input.eventId, userId: input.userId, idempotencyKey: input.idempotencyKey,
        ...(input.checkoutReference ? { checkoutReference: input.checkoutReference } : {}),
        expiresAt: new Date(now.getTime() + holdLifetimeMs),
        lines: { create: lines }
      },
      include: { lines: true }
    });
    await tx.auditLog.create({
      data: { actorId: input.userId, actorType: "user", action: "ticketing.hold.created",
        resourceType: "ticket_hold", resourceId: hold.id, metadata: { eventId: input.eventId, itemCount: lines.length } }
    });
    await tx.outboxMessage.create({
      data: { aggregateType: "ticket_hold", aggregateId: hold.id, eventType: "TicketHoldCreated",
        deduplicationKey: `ticket-hold.created:${hold.id}`,
        payload: { eventId: input.eventId, holdId: hold.id, userId: input.userId, expiresAt: hold.expiresAt.toISOString() } }
    });
    return hold;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function releaseHold(holdId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.ticketHold.findFirst({
      where: { id: holdId, userId },
      include: { lines: true }
    });
    if (!hold) throw new AppError("TICKET_HOLD_NOT_FOUND", "Ticket hold was not found", 404);
    if (hold.status !== "ACTIVE") return { id: hold.id, status: hold.status };
    const status = hold.expiresAt <= new Date() ? "EXPIRED" : "RELEASED";
    await tx.ticketHold.update({ where: { id: hold.id }, data: { status } });
    await tx.auditLog.create({
      data: { actorId: userId, actorType: "user", action: "ticketing.hold.released",
        resourceType: "ticket_hold", resourceId: hold.id, metadata: { status } }
    });
    await tx.outboxMessage.create({
      data: { aggregateType: "ticket_hold", aggregateId: hold.id, eventType: status === "EXPIRED" ? "TicketHoldExpired" : "TicketHoldReleased",
        deduplicationKey: `ticket-hold.terminal:${hold.id}`, payload: { holdId: hold.id, status } }
    });
    return { id: hold.id, status };
  });
}

export async function listManagedTicketTypes(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  if (!event) throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
  await prisma.$transaction((tx) => assertEventManager(tx, eventId, userId));
  const types = await prisma.ticketType.findMany({
    where: { eventId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" }
  });
  const now = new Date();
  const held = await prisma.ticketHoldLine.groupBy({
    by: ["ticketTypeId"], where: { ticketTypeId: { in: types.map((type) => type.id) }, hold: { status: "ACTIVE", expiresAt: { gt: now } } },
    _sum: { quantity: true }
  });
  const counts = new Map(held.map((item) => [item.ticketTypeId, item._sum.quantity ?? 0]));
  return types.map((type) => {
    const { versions, ...rest } = type;
    return { ...rest, heldQuantity: counts.get(type.id) ?? 0, availableQuantity: Math.max(0, type.capacity - type.issuedQuantity - (counts.get(type.id) ?? 0)), currentVersion: versions[0] ? asPublicVersion(versions[0]) : null };
  });
}

import type { EventStatus, Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

const eventInclude = {
  category: { select: { id: true, slug: true, name: true } },
  schedules: { orderBy: { startsAt: "asc" as const } },
  venue: true,
  organization: { select: { id: true, name: true, slug: true, status: true } }
};

async function assertManager(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string
) {
  const membership = await tx.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      role: true,
      status: true,
      organization: { select: { status: true } }
    }
  });
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    !["OWNER", "ADMIN"].includes(membership.role) ||
    membership.organization.status !== "ACTIVE"
  ) {
    throw new AppError(
      "EVENT_FORBIDDEN",
      "Active organization owners or admins may manage events",
      403
    );
  }
}

function snapshot(event: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
}

export async function listEventCategories() {
  return getPrismaClient().eventCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true, description: true }
  });
}

export async function createDraft(input: {
  organizationId: string;
  actorUserId: string;
  categoryId: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  format: "IN_PERSON" | "ONLINE" | "HYBRID";
  visibility: "PUBLIC" | "UNLISTED" | "INVITATION_ONLY";
  accessPolicy: "OPEN" | "APPROVAL_REQUIRED" | "INVITATION_ONLY";
  experienceLevel?: "STANDARD" | "PREMIUM" | null;
  timezone: string;
  schedules: { startsAt: string; endsAt: string; label?: string }[];
  venue?: {
    displayName?: string;
    city?: string;
    state?: string;
    country?: string;
    exactAddress?: string;
    accessInstructions?: string;
    privateUrl?: string;
  };
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await assertManager(tx, input.organizationId, input.actorUserId);
    const category = await tx.eventCategory.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true }
    });
    if (!category)
      throw new AppError(
        "EVENT_CATEGORY_NOT_FOUND",
        "Event category is unavailable",
        400
      );
    if (
      input.format === "ONLINE" &&
      input.venue &&
      (input.venue.exactAddress || input.venue.privateUrl)
    ) {
      throw new AppError(
        "ONLINE_EVENT_VENUE_INVALID",
        "Online events cannot include a physical address or private venue link",
        400
      );
    }
    const event = await tx.event.create({
      data: {
        organizationId: input.organizationId,
        categoryId: input.categoryId,
        title: input.title,
        slug: input.slug,
        summary: input.summary,
        description: input.description,
        format: input.format,
        visibility: input.visibility,
        accessPolicy: input.accessPolicy,
        ...(input.experienceLevel !== undefined
          ? { experienceLevel: input.experienceLevel }
          : {}),
        timezone: input.timezone,
        schedules: {
          create: input.schedules.map((item, index) => ({
            startsAt: new Date(item.startsAt),
            endsAt: new Date(item.endsAt),
            sortOrder: index,
            ...(item.label ? { label: item.label } : {})
          }))
        },
        ...(input.venue ? { venue: { create: input.venue } } : {})
      },
      include: eventInclude
    });
    await tx.eventRevision.create({
      data: {
        eventId: event.id,
        revisionNumber: 1,
        actorUserId: input.actorUserId,
        changeType: "CREATED",
        snapshot: snapshot(event)
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorUserId,
        actorType: "user",
        action: "event.draft.created",
        resourceType: "event",
        resourceId: event.id,
        metadata: { organizationId: input.organizationId }
      }
    });
    return event;
  });
}

export async function updateDraft(input: {
  eventId: string;
  actorUserId: string;
  categoryId: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  format: "IN_PERSON" | "ONLINE" | "HYBRID";
  visibility: "PUBLIC" | "UNLISTED" | "INVITATION_ONLY";
  accessPolicy: "OPEN" | "APPROVAL_REQUIRED" | "INVITATION_ONLY";
  experienceLevel?: "STANDARD" | "PREMIUM" | null;
  timezone: string;
  schedules: { startsAt: string; endsAt: string; label?: string }[];
  venue?: {
    displayName?: string;
    city?: string;
    state?: string;
    country?: string;
    exactAddress?: string;
    accessInstructions?: string;
    privateUrl?: string;
  };
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const current = await tx.event.findUnique({
      where: { id: input.eventId },
      include: eventInclude
    });
    if (!current)
      throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
    await assertManager(tx, current.organizationId, input.actorUserId);
    if (current.status !== "DRAFT")
      throw new AppError(
        "EVENT_NOT_EDITABLE",
        "Only draft events can be edited in this phase",
        409
      );
    const category = await tx.eventCategory.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true }
    });
    if (!category)
      throw new AppError(
        "EVENT_CATEGORY_NOT_FOUND",
        "Event category is unavailable",
        400
      );
    if (
      input.format === "ONLINE" &&
      input.venue &&
      (input.venue.exactAddress || input.venue.privateUrl)
    )
      throw new AppError(
        "ONLINE_EVENT_VENUE_INVALID",
        "Online events cannot include a physical address or private venue link",
        400
      );
    const updated = await tx.event.update({
      where: { id: current.id },
      data: {
        categoryId: input.categoryId,
        title: input.title,
        slug: input.slug,
        summary: input.summary,
        description: input.description,
        format: input.format,
        visibility: input.visibility,
        accessPolicy: input.accessPolicy,
        experienceLevel: input.experienceLevel ?? null,
        timezone: input.timezone,
        schedules: {
          deleteMany: {},
          create: input.schedules.map((item, index) => ({
            startsAt: new Date(item.startsAt),
            endsAt: new Date(item.endsAt),
            sortOrder: index,
            ...(item.label ? { label: item.label } : {})
          }))
        },
        ...(current.venue
          ? input.venue
            ? { venue: { update: input.venue } }
            : { venue: { delete: true } }
          : input.venue
            ? { venue: { create: input.venue } }
            : {})
      },
      include: eventInclude
    });
    const latest = await tx.eventRevision.aggregate({
      where: { eventId: current.id },
      _max: { revisionNumber: true }
    });
    await tx.eventRevision.create({
      data: {
        eventId: current.id,
        revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
        actorUserId: input.actorUserId,
        changeType: "UPDATED",
        snapshot: snapshot(updated)
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorUserId,
        actorType: "user",
        action: "event.draft.updated",
        resourceType: "event",
        resourceId: current.id
      }
    });
    return updated;
  });
}

export async function publishDraft(eventId: string, actorUserId: string) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: eventInclude
    });
    if (!event)
      throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
    await assertManager(tx, event.organizationId, actorUserId);
    if (event.status !== "DRAFT")
      throw new AppError(
        "EVENT_NOT_PUBLISHABLE",
        "Only draft events can be published",
        409
      );
    const approval = await tx.organizerApplication.findFirst({
      where: { organizationId: event.organizationId, status: "APPROVED" },
      select: { id: true }
    });
    if (!approval)
      throw new AppError(
        "ORGANIZER_APPROVAL_REQUIRED",
        "The organization must have an approved organizer application before publishing",
        403
      );
    if (event.moderationStatus !== "CLEAR")
      throw new AppError(
        "EVENT_MODERATION_BLOCKED",
        "This event is restricted from publishing",
        403
      );
    if (
      event.schedules.length === 0 ||
      event.schedules.some((item) => item.endsAt <= item.startsAt)
    )
      throw new AppError(
        "EVENT_SCHEDULE_INVALID",
        "A valid event schedule is required",
        400
      );
    if (event.format !== "ONLINE" && !event.venue)
      throw new AppError(
        "EVENT_VENUE_REQUIRED",
        "In-person and hybrid events require a venue",
        400
      );
    const updated = await tx.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
      include: eventInclude
    });
    await tx.eventRevision.create({
      data: {
        eventId,
        revisionNumber:
          (
            await tx.eventRevision.aggregate({
              where: { eventId },
              _max: { revisionNumber: true }
            })
          )._max.revisionNumber! + 1,
        actorUserId,
        changeType: "PUBLISHED",
        snapshot: snapshot(updated)
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        actorType: "user",
        action: "event.published",
        resourceType: "event",
        resourceId: eventId
      }
    });
    await tx.outboxMessage.create({
      data: {
        aggregateType: "event",
        aggregateId: eventId,
        eventType: "EventPublished",
        deduplicationKey: `event.published:${eventId}`,
        payload: { eventId, organizationId: event.organizationId }
      }
    });
    return updated;
  });
}

export async function listManagedEvents(
  organizationId: string,
  userId: string
) {
  const prisma = getPrismaClient();
  await assertManager(
    prisma as unknown as Prisma.TransactionClient,
    organizationId,
    userId
  );
  return prisma.event.findMany({
    where: { organizationId },
    include: eventInclude,
    orderBy: { updatedAt: "desc" },
    take: 100
  });
}

export async function listPublicEvents(query: {
  category?: string;
  city?: string;
  search?: string;
  cursor?: string;
  limit: number;
}) {
  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    visibility: "PUBLIC",
    moderationStatus: "CLEAR",
    ...(query.category
      ? { category: { slug: query.category, isActive: true } }
      : {}),
    ...(query.city
      ? { venue: { city: { equals: query.city, mode: "insensitive" } } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { summary: { contains: query.search, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const items = await getPrismaClient().event.findMany({
    where,
    take: query.limit + 1,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      slug: true,
      summary: true,
      format: true,
      visibility: true,
      accessPolicy: true,
      experienceLevel: true,
      timezone: true,
      publishedAt: true,
      category: { select: { slug: true, name: true } },
      schedules: {
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { startsAt: true, endsAt: true }
      },
      venue: {
        select: { displayName: true, city: true, state: true, country: true }
      },
      organization: { select: { name: true, slug: true } }
    }
  });
  const hasMore = items.length > query.limit;
  const data = hasMore ? items.slice(0, query.limit) : items;
  return {
    items: data,
    nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null
  };
}

export async function getPublicEvent(eventId: string) {
  const event = await getPrismaClient().event.findFirst({
    where: {
      id: eventId,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      moderationStatus: "CLEAR"
    },
    select: {
      id: true,
      title: true,
      slug: true,
      summary: true,
      description: true,
      format: true,
      visibility: true,
      accessPolicy: true,
      experienceLevel: true,
      timezone: true,
      publishedAt: true,
      category: { select: { slug: true, name: true } },
      schedules: {
        orderBy: { startsAt: "asc" },
        select: { startsAt: true, endsAt: true, label: true }
      },
      venue: {
        select: { displayName: true, city: true, state: true, country: true }
      },
      organization: { select: { name: true, slug: true } }
    }
  });
  if (!event) throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
  return event;
}

export async function getManagedEvent(eventId: string, userId: string) {
  const event = await getPrismaClient().event.findUnique({
    where: { id: eventId },
    include: eventInclude
  });
  if (!event) throw new AppError("EVENT_NOT_FOUND", "Event was not found", 404);
  await assertManager(
    getPrismaClient() as unknown as Prisma.TransactionClient,
    event.organizationId,
    userId
  );
  return event;
}

export function isEventLifecycleStatus(status: string): status is EventStatus {
  return [
    "DRAFT",
    "PUBLISHED",
    "SALES_PAUSED",
    "ONGOING",
    "COMPLETED",
    "POSTPONED",
    "CANCELLED"
  ].includes(status);
}

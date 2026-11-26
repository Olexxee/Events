import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaClientTypes } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertActiveVerifiedAccount } from "../identity/identity.contracts.js";

const DEFAULT_HOLD_DURATION_SECONDS = 600;
const MIN_HOLD_DURATION_SECONDS = 60;
const MAX_HOLD_DURATION_SECONDS = 1800;

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    fail("VYBE_ACCOMMODATION_DATE_INVALID", "Dates must be valid YYYY-MM-DD calendar dates", 400);
  }
  return date;
}

function enumerateNights(checkInDate: string, checkOutDate: string): string[] {
  const start = dateOnly(checkInDate);
  const end = dateOnly(checkOutDate);
  if (start.getTime() >= end.getTime()) {
    fail(
      "VYBE_ACCOMMODATION_DATE_RANGE_INVALID",
      "Check-in date must be before the exclusive check-out date",
      400
    );
  }
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (dates.length > 366) {
      fail(
        "VYBE_ACCOMMODATION_STAY_TOO_LONG",
        "A stay may cover at most 366 room nights",
        400
      );
    }
  }
  return dates;
}

function sameLocation(
  left: { city: string; state: string; country: string },
  right: { city: string; state: string; country: string }
) {
  return (
    left.city.trim().toLowerCase() === right.city.trim().toLowerCase() &&
    left.state.trim().toLowerCase() === right.state.trim().toLowerCase() &&
    left.country.trim().toLowerCase() === right.country.trim().toLowerCase()
  );
}

function approvedLocations(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, Prisma.JsonValue>;
    if (
      typeof item.city !== "string" ||
      typeof item.state !== "string" ||
      typeof item.country !== "string"
    ) {
      return [];
    }
    return [{ city: item.city, state: item.state, country: item.country }];
  });
}

async function getDatabaseNow(tx: PrismaClientTypes.TransactionClient) {
  const result = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`
  );
  return result[0]?.now ?? new Date();
}

async function getHoldDurationSeconds(
  tx: PrismaClientTypes.TransactionClient
) {
  const policy = await tx.vybeInventoryPolicy.findUnique({
    where: { category: "ACCOMMODATION" },
    select: { holdDurationSeconds: true }
  });
  const duration = policy?.holdDurationSeconds ?? DEFAULT_HOLD_DURATION_SECONDS;
  if (
    duration < MIN_HOLD_DURATION_SECONDS ||
    duration > MAX_HOLD_DURATION_SECONDS
  ) {
    fail(
      "VYBE_HOLD_POLICY_INVALID",
      "Accommodation hold duration must be between 60 and 1800 seconds",
      500
    );
  }
  return duration;
}

async function assertAccommodationCategoryAvailable(
  tx: PrismaClientTypes.TransactionClient,
  roomCategoryId: string
) {
  const offeringLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT offering."id"
      FROM "vybe_accommodation_room_categories" category
      JOIN "vybe_offerings" offering ON offering."id" = category."offering_id"
     WHERE category."id" = ${roomCategoryId}::uuid
       AND offering."status" = 'PUBLISHED'
     FOR SHARE OF offering`
  );
  if (offeringLock.length === 0) {
    fail(
      "VYBE_ACCOMMODATION_UNAVAILABLE",
      "This accommodation is not currently available",
      404
    );
  }

  const category = await tx.vybeAccommodationRoomCategory.findUnique({
    where: { id: roomCategoryId },
    include: {
      property: true,
      providerProfile: {
        include: {
          organization: { select: { id: true, status: true } },
          approvals: {
            where: {
              category: "ACCOMMODATION",
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
            }
          }
        }
      },
      offering: {
        include: {
          versions: {
            where: { status: "PUBLISHED" },
            orderBy: { version: "desc" }
          }
        }
      }
    }
  });
  if (
    !category ||
    category.status !== "ACTIVE" ||
    category.property.status !== "ACTIVE" ||
    category.physicalUnitCount === null ||
    !category.physicalUnitCountEvidenceReference ||
    category.offering.status !== "PUBLISHED" ||
    !category.offering.currentPublishedVersion
  ) {
    fail(
      "VYBE_ACCOMMODATION_UNAVAILABLE",
      "This accommodation is not currently available",
      404
    );
  }
  if (category.providerProfile.organization.status !== "ACTIVE") {
    fail("VYBE_PROVIDER_INACTIVE", "The accommodation provider is not active", 404);
  }
  const approval = category.providerProfile.approvals.find(
    (item) => item.category === "ACCOMMODATION"
  );
  if (
    !approval ||
    !approvedLocations(approval.locations).some((location) =>
      sameLocation(location, category.property)
    )
  ) {
    fail(
      "VYBE_PROVIDER_APPROVAL_REQUIRED",
      "The accommodation provider approval is not active for this property",
      404
    );
  }
  const version = category.offering.versions.find(
    (item) => item.version === category.offering.currentPublishedVersion
  );
  if (!version) {
    fail(
      "VYBE_ACCOMMODATION_UNAVAILABLE",
      "The accommodation offering has no current published version",
      404
    );
  }
  const activation = await tx.vybeCategoryActivation.findUnique({
    where: { category: "ACCOMMODATION" },
    select: { isActive: true }
  });
  if (!activation?.isActive) {
    fail(
      "VYBE_CATEGORY_INACTIVE",
      "Accommodation bookings are not enabled at this time",
      404
    );
  }

  const organizationLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM organizations
      WHERE id = ${category.providerProfile.organization.id}::uuid
        AND status = 'ACTIVE'
      FOR SHARE`
  );
  const approvalLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_provider_approvals
      WHERE id = ${approval.id}::uuid
        AND status = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      FOR SHARE`
  );
  const activationLock = await tx.$queryRaw<Array<{ category: string }>>(
    Prisma.sql`SELECT category FROM vybe_category_activations
      WHERE category = 'ACCOMMODATION'::vybe_category
        AND is_active = true
      FOR SHARE`
  );
  if (
    approvalLock.length === 0 ||
    organizationLock.length === 0 ||
    activationLock.length === 0
  ) {
    fail(
      "VYBE_ACCOMMODATION_UNAVAILABLE",
      "This accommodation is not currently available",
      404
    );
  }
  return { category, version };
}

async function lockCategoryAndNights(
  tx: PrismaClientTypes.TransactionClient,
  roomCategoryId: string,
  dates: string[]
) {
  const propertyLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT property."id"
      FROM "vybe_accommodation_properties" property
      JOIN "vybe_accommodation_room_categories" category
        ON category."property_id" = property."id"
     WHERE category."id" = ${roomCategoryId}::uuid
     FOR SHARE OF property`
  );
  const categoryLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_accommodation_room_categories
      WHERE id = ${roomCategoryId}::uuid
      FOR UPDATE`
  );
  if (propertyLock.length === 0 || categoryLock.length === 0) {
    fail("VYBE_ACCOMMODATION_UNAVAILABLE", "This accommodation is not available", 404);
  }

  await tx.vybeAccommodationNightLock.createMany({
    data: dates.map((stayDate) => ({
      roomCategoryId,
      stayDate: dateOnly(stayDate)
    })),
    skipDuplicates: true
  });
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_accommodation_night_locks
      WHERE room_category_id = ${roomCategoryId}::uuid
        AND stay_date >= ${dates[0]}::date
        AND stay_date < ${dateOnly(dates[dates.length - 1] as string).toISOString().slice(0, 10)}::date + INTERVAL '1 day'
      ORDER BY stay_date
      FOR UPDATE`
  );
}

async function recordAccommodationHoldEvent(
  tx: PrismaClientTypes.TransactionClient,
  input: {
    actorUserId: string | null;
    actorType?: string;
    action: string;
    holdId: string;
    roomCategoryId: string;
    eventType: string;
    payload: Prisma.InputJsonObject;
  }
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorUserId,
      actorType: input.actorType ?? "user",
      action: input.action,
      resourceType: "vybe_accommodation_hold",
      resourceId: input.holdId,
      metadata: input.payload
    }
  });
  await enqueueOutboxMessage(tx, {
    aggregateType: "vybe_accommodation_room_category",
    aggregateId: input.roomCategoryId,
    eventType: input.eventType,
    deduplicationKey: `vybe.accommodation.hold:${input.holdId}:${input.action.split(".").at(-1)}`,
    payload: input.payload
  });
}

export async function expireAccommodationHoldsInTransaction(
  tx: PrismaClientTypes.TransactionClient,
  roomCategoryId: string
) {
  const now = await getDatabaseNow(tx);
  const expired = await tx.vybeAccommodationHold.findMany({
    where: {
      roomCategoryId,
      status: "ACTIVE",
      expiresAt: { lte: now }
    },
    select: { id: true, roomQuantity: true }
  });
  if (expired.length === 0) return;
  await tx.vybeAccommodationHold.updateMany({
    where: { id: { in: expired.map((hold) => hold.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED" }
  });
  for (const hold of expired) {
    await recordAccommodationHoldEvent(tx, {
      actorUserId: null,
      actorType: "system",
      action: "vybe.accommodation.hold_expired",
      holdId: hold.id,
      roomCategoryId,
      eventType: "vybe.accommodation.hold_expired.v1",
      payload: {
        holdId: hold.id,
        roomCategoryId,
        roomQuantity: hold.roomQuantity
      }
    });
  }
}

async function getAllocationNights(
  tx: PrismaClientTypes.TransactionClient,
  roomCategoryId: string,
  dates: string[],
  now: Date,
  expiresAt: Date
) {
  return tx.vybeAccommodationAllocationNight.findMany({
    where: {
      roomCategoryId,
      stayDate: { in: dates.map(dateOnly) },
      allocation: {
        status: "ACTIVE",
        releaseCutoffAt: { gt: expiresAt }
      }
    },
    include: {
      allocation: {
        select: {
          id: true,
          releaseCutoffAt: true,
          releaseCutoffLocal: true,
          releaseCutoffTimezone: true
        }
      },
      holdNights: {
        where: {
          hold: {
            status: "ACTIVE",
            expiresAt: { gt: now }
          }
        },
        select: { quantity: true }
      }
    },
    orderBy: { stayDate: "asc" }
  });
}

function getAvailableQuantity(
  night: {
    allocatedQuantity: number;
    committedQuantity: number;
    holdNights: { quantity: number }[];
  }
) {
  return Math.max(
    0,
    night.allocatedQuantity -
      night.committedQuantity -
      night.holdNights.reduce((sum, item) => sum + item.quantity, 0)
  );
}

function buildAvailability(
  dates: string[],
  allocationNights: Awaited<ReturnType<typeof getAllocationNights>>,
  requestedRoomQuantity: number,
  now: Date,
  holdDurationSeconds: number
) {
  const byNight = dates.map((stayDate) => {
    const availableQuantity = allocationNights
      .filter((night) => night.stayDate.toISOString().slice(0, 10) === stayDate)
      .reduce((sum, night) => sum + getAvailableQuantity(night), 0);
    return { stayDate, availableQuantity };
  });
  const minimumAvailableQuantity = Math.min(
    ...byNight.map((night) => night.availableQuantity)
  );
  return {
    nights: byNight,
    minimumAvailableQuantity,
    requestedRoomQuantity,
    isAvailable: minimumAvailableQuantity >= requestedRoomQuantity,
    holdDurationSeconds,
    asOf: now.toISOString()
  };
}

export async function getAccommodationAvailability(input: {
  roomCategoryId: string;
  checkInDate: string;
  checkOutDate: string;
  roomQuantity: number;
}) {
  const prisma = getPrismaClient();
  const dates = enumerateNights(input.checkInDate, input.checkOutDate);
  return prisma.$transaction(async (tx) => {
    await assertAccommodationCategoryAvailable(tx, input.roomCategoryId);
    const now = new Date();
    const holdDurationSeconds = await getHoldDurationSeconds(tx);
    const expiresAt = new Date(now.getTime() + holdDurationSeconds * 1000);
    const allocationNights = await getAllocationNights(
      tx,
      input.roomCategoryId,
      dates,
      now,
      expiresAt
    );
    return {
      roomCategoryId: input.roomCategoryId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      ...buildAvailability(
        dates,
        allocationNights,
        input.roomQuantity,
        now,
        holdDurationSeconds
      )
    };
  });
}

export async function createAccommodationHold(input: {
  roomCategoryId: string;
  userId: string;
  checkInDate: string;
  checkOutDate: string;
  roomQuantity: number;
  idempotencyKey: string;
}) {
  const prisma = getPrismaClient();
  const dates = enumerateNights(input.checkInDate, input.checkOutDate);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        roomCategoryId: input.roomCategoryId,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        roomQuantity: input.roomQuantity
      })
    )
    .digest("hex");

  try {
    return await prisma.$transaction(async (tx) => {
      await assertActiveVerifiedAccount(tx, input.userId);
      const { category, version } = await assertAccommodationCategoryAvailable(
        tx,
        input.roomCategoryId
      );
      await lockCategoryAndNights(tx, category.id, dates);
      const lockedCategory = await tx.vybeAccommodationRoomCategory.findUnique({
        where: { id: category.id },
        include: { property: true, offering: true }
      });
      if (
        !lockedCategory ||
        lockedCategory.status !== "ACTIVE" ||
        lockedCategory.property.status !== "ACTIVE" ||
        lockedCategory.physicalUnitCount === null ||
        !lockedCategory.physicalUnitCountEvidenceReference ||
        lockedCategory.offeringId !== category.offeringId
      ) {
        fail(
          "VYBE_ACCOMMODATION_UNAVAILABLE",
          "This accommodation is not currently available",
          404
        );
      }
      const now = await getDatabaseNow(tx);
      const existing = await tx.vybeAccommodationHold.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey
          }
        },
        include: { nights: true }
      });
      if (existing) {
        if (
          existing.roomCategoryId !== input.roomCategoryId ||
          existing.requestHash !== requestHash
        ) {
          fail(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different accommodation hold"
          );
        }
        if (existing.status === "ACTIVE" && existing.expiresAt > now) {
          return existing;
        }
        await expireAccommodationHoldsInTransaction(
          tx,
          input.roomCategoryId
        );
        fail(
          "VYBE_HOLD_NO_LONGER_ACTIVE",
          "This idempotent accommodation hold has expired or been released"
        );
      }

      const holdDurationSeconds = await getHoldDurationSeconds(tx);
      const expiresAt = new Date(now.getTime() + holdDurationSeconds * 1000);
      await expireAccommodationHoldsInTransaction(tx, category.id, now);

      const allocationNights = await getAllocationNights(
        tx,
        category.id,
        dates,
        now,
        expiresAt
      );
      const planned: {
        allocationNightId: string;
        stayDate: string;
        quantity: number;
        releaseCutoffAt: Date;
        releaseCutoffLocal: string;
        releaseCutoffTimezone: string;
      }[] = [];

      for (const stayDate of dates) {
        const lots = allocationNights
          .filter((night) => night.stayDate.toISOString().slice(0, 10) === stayDate)
          .sort(
            (left, right) =>
              left.allocation.releaseCutoffAt.getTime() -
              right.allocation.releaseCutoffAt.getTime()
          );
        let remaining = input.roomQuantity;
        for (const lot of lots) {
          const available = getAvailableQuantity(lot);
          const quantity = Math.min(available, remaining);
          if (quantity > 0) {
            planned.push({
              allocationNightId: lot.id,
              stayDate,
              quantity,
              releaseCutoffAt: lot.allocation.releaseCutoffAt,
              releaseCutoffLocal: lot.allocation.releaseCutoffLocal,
              releaseCutoffTimezone: lot.allocation.releaseCutoffTimezone
            });
            remaining -= quantity;
          }
          if (remaining === 0) break;
        }
        if (remaining > 0) {
          fail(
            "VYBE_INSUFFICIENT_ACCOMMODATION_INVENTORY",
            `The requested room quantity is not available for ${stayDate}`
          );
        }
      }

      const content = version.content as Prisma.JsonValue;
      const hold = await tx.vybeAccommodationHold.create({
        data: {
          roomCategoryId: category.id,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          checkInDate: dateOnly(input.checkInDate),
          checkOutDate: dateOnly(input.checkOutDate),
          roomQuantity: input.roomQuantity,
          expiresAt,
          snapshot: {
            roomCategory: {
              id: lockedCategory.id,
              name: lockedCategory.name,
              maxOccupancy: lockedCategory.maxOccupancy,
              specifications: lockedCategory.specifications
            },
            property: {
              id: lockedCategory.property.id,
              name: lockedCategory.property.name,
              city: lockedCategory.property.city,
              state: lockedCategory.property.state,
              country: lockedCategory.property.country,
              timezone: lockedCategory.property.timezone
            },
            offering: {
              id: category.offering.id,
              version: version.version,
              content
            },
            checkInDate: input.checkInDate,
            checkOutDate: input.checkOutDate,
            roomQuantity: input.roomQuantity
          } as Prisma.InputJsonObject
        }
      });
      await tx.vybeAccommodationHoldNight.createMany({
        data: planned.map((line) => ({
          holdId: hold.id,
          allocationNightId: line.allocationNightId,
          roomCategoryId: category.id,
          stayDate: dateOnly(line.stayDate),
          quantity: line.quantity,
          releaseCutoffAtSnapshot: line.releaseCutoffAt,
          releaseCutoffLocalSnapshot: line.releaseCutoffLocal,
          releaseCutoffTimezoneSnapshot: line.releaseCutoffTimezone
        }))
      });
      await recordAccommodationHoldEvent(tx, {
        actorUserId: input.userId,
        action: "vybe.accommodation.hold_created",
        holdId: hold.id,
        roomCategoryId: category.id,
        eventType: "vybe.accommodation.hold_created.v1",
        payload: {
          holdId: hold.id,
          roomCategoryId: category.id,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          roomQuantity: input.roomQuantity,
          expiresAt: expiresAt.toISOString(),
          allocations: planned.map((line) => ({
            allocationNightId: line.allocationNightId,
            stayDate: line.stayDate,
            quantity: line.quantity
          }))
        }
      });
      return tx.vybeAccommodationHold.findUniqueOrThrow({
        where: { id: hold.id },
        include: { nights: { orderBy: { stayDate: "asc" } } }
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key has already been used",
        409
      );
    }
    throw error;
  }
}

export async function getMyAccommodationHold(input: {
  holdId: string;
  userId: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const initial = await tx.vybeAccommodationHold.findUnique({
      where: { id: input.holdId },
      include: { nights: { orderBy: { stayDate: "asc" } } }
    });
    if (!initial) {
      fail("VYBE_ACCOMMODATION_HOLD_NOT_FOUND", "Accommodation hold was not found", 404);
    }
    if (initial.userId !== input.userId) {
      fail("VYBE_ACCOMMODATION_HOLD_FORBIDDEN", "Only the hold owner may view it", 403);
    }
    if (initial.nights.length === 0) {
      fail("VYBE_ACCOMMODATION_HOLD_INVALID", "Accommodation hold has no reserved room nights", 409);
    }
    const dates = [
      ...new Set(
        initial.nights.map((night) => night.stayDate.toISOString().slice(0, 10))
      )
    ].sort();
    await lockCategoryAndNights(tx, initial.roomCategoryId, dates);
    await expireAccommodationHoldsInTransaction(
      tx,
      initial.roomCategoryId
    );
    return tx.vybeAccommodationHold.findUniqueOrThrow({
      where: { id: initial.id },
      include: { nights: { orderBy: { stayDate: "asc" } } }
    });
  });
}

export async function releaseMyAccommodationHold(input: {
  holdId: string;
  userId: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const initial = await tx.vybeAccommodationHold.findUnique({
      where: { id: input.holdId },
      include: { nights: { orderBy: { stayDate: "asc" } } }
    });
    if (!initial) {
      fail("VYBE_ACCOMMODATION_HOLD_NOT_FOUND", "Accommodation hold was not found", 404);
    }
    if (initial.userId !== input.userId) {
      fail("VYBE_ACCOMMODATION_HOLD_FORBIDDEN", "Only the hold owner may release it", 403);
    }
    if (initial.nights.length === 0) {
      fail("VYBE_ACCOMMODATION_HOLD_INVALID", "Accommodation hold has no reserved room nights", 409);
    }
    const dates = [
      ...new Set(
        initial.nights.map((night) => night.stayDate.toISOString().slice(0, 10))
      )
    ].sort();
    await lockCategoryAndNights(tx, initial.roomCategoryId, dates);
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM vybe_accommodation_holds
        WHERE id = ${initial.id}::uuid
        FOR UPDATE`
    );
    await expireAccommodationHoldsInTransaction(
      tx,
      initial.roomCategoryId,
      new Date()
    );
    const now = await getDatabaseNow(tx);
    const current = await tx.vybeAccommodationHold.findUniqueOrThrow({
      where: { id: initial.id }
    });
    if (current.status !== "ACTIVE") return current;
    const status = current.expiresAt <= now ? "EXPIRED" : "RELEASED";
    const updated = await tx.vybeAccommodationHold.update({
      where: { id: current.id },
      data: { status }
    });
    await recordAccommodationHoldEvent(tx, {
      actorUserId: status === "EXPIRED" ? null : input.userId,
      actorType: status === "EXPIRED" ? "system" : "user",
      action:
        status === "EXPIRED"
          ? "vybe.accommodation.hold_expired"
          : "vybe.accommodation.hold_released",
      holdId: updated.id,
      roomCategoryId: updated.roomCategoryId,
      eventType:
        status === "EXPIRED"
          ? "vybe.accommodation.hold_expired.v1"
          : "vybe.accommodation.hold_released.v1",
      payload: {
        holdId: updated.id,
        roomCategoryId: updated.roomCategoryId,
        roomQuantity: updated.roomQuantity
      }
    });
    return updated;
  });
}

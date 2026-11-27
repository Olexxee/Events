import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";

type CancellationDecision = "ACCEPTED" | "REJECTED" | "ALREADY_CANCELLED";

type CancellationPolicySnapshot = {
  policyVersion: string;
  acceptedAt: string;
  customerCancellation: {
    allowed: boolean;
    cutoffAt: string | null;
    timezone: string;
    displayText: string;
  };
};

type InventoryRelease =
  | {
      kind: "QUANTITY_POOL";
      sourceHoldId: string;
      poolId: string;
      quantity: number;
    }
  | {
      kind: "CAPACITY_SESSION";
      sourceHoldId: string;
      occurrenceId: string;
      quantity: number;
    }
  | {
      kind: "EXCLUSIVE_RESOURCE";
      sourceHoldId: string;
      occurrenceId: string;
      resourceId: string;
      occupancyId: string;
    };

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parsePolicy(value: Prisma.JsonValue): {
  policy: CancellationPolicySnapshot;
  cutoffAt: Date | null;
} | null {
  const terms = asObject(value);
  const rawPolicy = asObject(terms.cancellationPolicy);
  const customerCancellation = asObject(rawPolicy.customerCancellation);
  const policyVersion = rawPolicy.policyVersion;
  const acceptedAt = rawPolicy.acceptedAt;
  const allowed = customerCancellation.allowed;
  const cutoffValue = customerCancellation.cutoffAt;
  const timezone = customerCancellation.timezone;
  const displayText = customerCancellation.displayText;

  if (
    typeof policyVersion !== "string" ||
    policyVersion.trim().length === 0 ||
    typeof acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(acceptedAt)) ||
    typeof allowed !== "boolean" ||
    (cutoffValue !== null &&
      (typeof cutoffValue !== "string" ||
        !Number.isFinite(Date.parse(cutoffValue)))) ||
    typeof timezone !== "string" ||
    typeof displayText !== "string" ||
    displayText.trim().length < 20
  ) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return null;
  }

  const cutoffAt =
    cutoffValue === null ? null : new Date(cutoffValue as string);

  return {
    policy: {
      policyVersion,
      acceptedAt,
      customerCancellation: {
        allowed,
        cutoffAt: cutoffValue === null ? null : cutoffAt!.toISOString(),
        timezone,
        displayText
      }
    },
    cutoffAt
  };
}

function requestHash(input: { bookingId: string; reason: string }): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        bookingId: input.bookingId.toLowerCase(),
        reason: input.reason
      })
    )
    .digest("hex");
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS now`
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail(
      "VYBE_BOOKING_CANCELLATION_CLOCK_UNAVAILABLE",
      "The cancellation decision clock is unavailable",
      503
    );
  }
  return now;
}

async function lockBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  customerUserId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
        FROM "vybe_bookings"
       WHERE "id" = ${bookingId}::uuid
         AND "customer_user_id" = ${customerUserId}::uuid
       FOR UPDATE
    `
  );
  if (rows.length === 0) {
    fail("VYBE_BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
}

async function lockAndValidateInventory(
  tx: Prisma.TransactionClient,
  booking: {
    id: string;
    customerUserId: string;
    offeringId: string;
    sourceType: string;
    inventoryHoldId: string | null;
    timeSlotHoldId: string | null;
    serviceStartsAt: Date | null;
    serviceEndsAt: Date | null;
    blockedStartsAt: Date | null;
    blockedEndsAt: Date | null;
    timezone: string | null;
    quantity: number | null;
    resourceId: string | null;
  }
): Promise<InventoryRelease> {
  if (booking.sourceType === "QUANTITY_POOL") {
    if (!booking.inventoryHoldId || booking.timeSlotHoldId) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The booking source reference is invalid"
      );
    }
    const initial = await tx.vybeInventoryHold.findUnique({
      where: { id: booking.inventoryHoldId }
    });
    if (
      !initial ||
      initial.status !== "CONVERTED" ||
      initial.userId !== booking.customerUserId ||
      initial.quantity !== booking.quantity
    ) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The converted quantity-pool hold no longer matches its booking"
      );
    }
    const poolLock = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id" FROM "vybe_inventory_pools"
         WHERE "id" = ${initial.poolId}::uuid
         FOR UPDATE
      `
    );
    if (poolLock.length === 0) {
      fail(
        "VYBE_BOOKING_INVENTORY_UNAVAILABLE",
        "The booking inventory pool is unavailable"
      );
    }
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id" FROM "vybe_inventory_holds"
         WHERE "id" = ${initial.id}::uuid
         FOR UPDATE
      `
    );
    const current = await tx.vybeInventoryHold.findUniqueOrThrow({
      where: { id: initial.id },
      include: { pool: { select: { offeringId: true } } }
    });
    if (
      current.status !== "CONVERTED" ||
      current.userId !== booking.customerUserId ||
      current.pool.offeringId !== booking.offeringId ||
      current.quantity !== booking.quantity ||
      current.poolId !== initial.poolId
    ) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The converted quantity-pool hold no longer matches its booking"
      );
    }
    return {
      kind: "QUANTITY_POOL",
      sourceHoldId: current.id,
      poolId: current.poolId,
      quantity: current.quantity
    };
  }

  if (!booking.timeSlotHoldId || booking.inventoryHoldId) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The booking source reference is invalid"
    );
  }
  const initial = await tx.vybeTimeSlotHold.findUnique({
    where: { id: booking.timeSlotHoldId },
    include: {
      occurrence: {
        select: {
          offeringId: true,
          timezone: true,
          resourceGroupId: true
        }
      }
    }
  });
  if (
    !initial ||
    initial.status !== "CONVERTED" ||
    initial.userId !== booking.customerUserId ||
    initial.occurrence.offeringId !== booking.offeringId ||
    initial.serviceStartsAt.getTime() !== booking.serviceStartsAt?.getTime() ||
    initial.serviceEndsAt.getTime() !== booking.serviceEndsAt?.getTime() ||
    initial.blockedStartsAt.getTime() !== booking.blockedStartsAt?.getTime() ||
    initial.blockedEndsAt.getTime() !== booking.blockedEndsAt?.getTime() ||
    initial.occurrence.timezone !== booking.timezone
  ) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The converted time-slot hold no longer matches its booking"
    );
  }

  const occurrenceLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "vybe_time_slot_occurrences"
       WHERE "id" = ${initial.occurrenceId}::uuid
       FOR UPDATE
    `
  );
  if (occurrenceLock.length === 0) {
    fail(
      "VYBE_BOOKING_INVENTORY_UNAVAILABLE",
      "The booked time-slot occurrence is unavailable"
    );
  }

  if (initial.resourceId === null) {
    if (
      initial.capacityQuantity === null ||
      initial.capacityQuantity !== booking.quantity
    ) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The capacity hold quantity no longer matches its booking"
      );
    }
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id" FROM "vybe_time_slot_holds"
         WHERE "id" = ${initial.id}::uuid
         FOR UPDATE
      `
    );
    const current = await tx.vybeTimeSlotHold.findUniqueOrThrow({
      where: { id: initial.id },
      include: {
        occurrence: {
          select: {
            offeringId: true,
            timezone: true,
            resourceGroupId: true,
            capacity: true
          }
        }
      }
    });
    if (
      current.status !== "CONVERTED" ||
      current.capacityQuantity !== booking.quantity ||
      current.resourceId !== null ||
      current.occurrence.offeringId !== booking.offeringId ||
      current.occurrence.timezone !== booking.timezone ||
      current.serviceStartsAt.getTime() !==
        booking.serviceStartsAt?.getTime() ||
      current.serviceEndsAt.getTime() !== booking.serviceEndsAt?.getTime() ||
      current.blockedStartsAt.getTime() !==
        booking.blockedStartsAt?.getTime() ||
      current.blockedEndsAt.getTime() !== booking.blockedEndsAt?.getTime() ||
      !current.occurrence.capacity
    ) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The converted capacity hold no longer matches its booking"
      );
    }
    return {
      kind: "CAPACITY_SESSION",
      sourceHoldId: current.id,
      occurrenceId: current.occurrenceId,
      quantity: current.capacityQuantity
    };
  }

  if (
    booking.resourceId !== initial.resourceId ||
    initial.capacityQuantity !== null ||
    !booking.blockedStartsAt ||
    !booking.blockedEndsAt
  ) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The exclusive-resource hold no longer matches its booking"
    );
  }

  const resourceGroupId = initial.occurrence.resourceGroupId;
  if (!resourceGroupId) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The exclusive-resource occurrence has no resource group"
    );
  }
  const groupLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "vybe_time_slot_resource_groups"
       WHERE "id" = ${resourceGroupId}::uuid
       FOR UPDATE
    `
  );
  if (groupLock.length === 0) {
    fail(
      "VYBE_BOOKING_INVENTORY_UNAVAILABLE",
      "The booked resource group is unavailable"
    );
  }
  const resourceLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "vybe_time_slot_resources"
       WHERE "id" = ${initial.resourceId}::uuid
       FOR UPDATE
    `
  );
  if (resourceLock.length === 0) {
    fail(
      "VYBE_BOOKING_INVENTORY_UNAVAILABLE",
      "The booked exclusive resource is unavailable"
    );
  }
  const membershipLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
        FROM "vybe_time_slot_resource_group_members"
       WHERE "resource_group_id" = ${resourceGroupId}::uuid
         AND "resource_id" = ${initial.resourceId}::uuid
         AND (
           "valid_from" IS NULL
           OR "valid_from" <= ${booking.blockedStartsAt}::timestamptz
         )
         AND (
           "valid_until" IS NULL
           OR "valid_until" >= ${booking.blockedEndsAt}::timestamptz
         )
       FOR UPDATE
    `
  );
  if (membershipLock.length === 0) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The booked resource is not covered by its group membership"
    );
  }
  await tx.$queryRaw(
    Prisma.sql`
      SELECT "id" FROM "vybe_time_slot_holds"
       WHERE "id" = ${initial.id}::uuid
       FOR UPDATE
    `
  );
  const current = await tx.vybeTimeSlotHold.findUniqueOrThrow({
    where: { id: initial.id },
    include: {
      occurrence: {
        select: {
          offeringId: true,
          timezone: true,
          resourceGroupId: true
        }
      }
    }
  });
  if (
    current.status !== "CONVERTED" ||
    current.resourceId !== booking.resourceId ||
    current.capacityQuantity !== null ||
    current.occurrence.offeringId !== booking.offeringId ||
    current.occurrence.timezone !== booking.timezone ||
    current.occurrence.resourceGroupId !== resourceGroupId ||
    current.serviceStartsAt.getTime() !== booking.serviceStartsAt?.getTime() ||
    current.serviceEndsAt.getTime() !== booking.serviceEndsAt?.getTime() ||
    current.blockedStartsAt.getTime() !== booking.blockedStartsAt?.getTime() ||
    current.blockedEndsAt.getTime() !== booking.blockedEndsAt?.getTime()
  ) {
    fail(
      "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
      "The converted exclusive-resource hold no longer matches its booking"
    );
  }
  await tx.$queryRaw(
    Prisma.sql`
      SELECT "id" FROM "vybe_time_slot_resource_occupancies"
       WHERE "source_hold_id" = ${current.id}::uuid
       FOR UPDATE
    `
  );
  const occupancy = await tx.vybeTimeSlotResourceOccupancy.findUnique({
    where: { sourceHoldId: current.id }
  });
  if (
    !occupancy ||
    occupancy.status !== "COMMITTED" ||
    occupancy.bookingId !== booking.id ||
    occupancy.resourceId !== current.resourceId
  ) {
    fail(
      "VYBE_BOOKING_OCCUPANCY_INVARIANT_BROKEN",
      "The booking's committed resource occupancy is unavailable"
    );
  }
  return {
    kind: "EXCLUSIVE_RESOURCE",
    sourceHoldId: current.id,
    occurrenceId: current.occurrenceId,
    resourceId: current.resourceId,
    occupancyId: occupancy.id
  };
}

async function releaseInventory(
  tx: Prisma.TransactionClient,
  bookingId: string,
  release: InventoryRelease
): Promise<void> {
  if (release.kind === "QUANTITY_POOL") {
    const updated = await tx.vybeInventoryPool.updateMany({
      where: {
        id: release.poolId,
        committedQuantity: { gte: release.quantity }
      },
      data: { committedQuantity: { decrement: release.quantity } }
    });
    if (updated.count !== 1) {
      fail(
        "VYBE_BOOKING_INVENTORY_INVARIANT_BROKEN",
        "The quantity-pool commitment cannot be released safely"
      );
    }
    return;
  }

  if (release.kind === "CAPACITY_SESSION") {
    const updated = await tx.vybeTimeSlotCapacity.updateMany({
      where: {
        occurrenceId: release.occurrenceId,
        committedQuantity: { gte: release.quantity }
      },
      data: { committedQuantity: { decrement: release.quantity } }
    });
    if (updated.count !== 1) {
      fail(
        "VYBE_BOOKING_INVENTORY_INVARIANT_BROKEN",
        "The capacity-session commitment cannot be released safely"
      );
    }
    return;
  }

  const updated = await tx.vybeTimeSlotResourceOccupancy.updateMany({
    where: {
      id: release.occupancyId,
      bookingId,
      sourceHoldId: release.sourceHoldId,
      status: "COMMITTED"
    },
    data: { status: "RELEASED" }
  });
  if (updated.count !== 1) {
    fail(
      "VYBE_BOOKING_OCCUPANCY_INVARIANT_BROKEN",
      "The committed resource occupancy cannot be released safely"
    );
  }
}

async function recordDecision(
  tx: Prisma.TransactionClient,
  input: {
    cancellationId: string;
    bookingId: string;
    publicReference: string;
    customerUserId: string;
    sourceType: "QUANTITY_POOL" | "CAPACITY_SESSION" | "EXCLUSIVE_RESOURCE";
    sourceHoldId: string;
    decision: CancellationDecision;
    decisionCode: string | null;
    policyVersion: string | null;
    decidedAt: Date;
  }
): Promise<void> {
  const payload: Prisma.InputJsonObject = {
    cancellationId: input.cancellationId,
    bookingId: input.bookingId,
    publicReference: input.publicReference,
    sourceType: input.sourceType,
    sourceHoldId: input.sourceHoldId,
    decision: input.decision,
    decisionCode: input.decisionCode,
    policyVersion: input.policyVersion,
    decidedAt: input.decidedAt.toISOString()
  };
  await tx.auditLog.create({
    data: {
      actorId: input.customerUserId,
      actorType: "customer",
      action: "vybe.booking.cancellation_decided",
      resourceType: "vybe_booking",
      resourceId: input.bookingId,
      outcome: input.decision === "REJECTED" ? "rejected" : "success",
      metadata: payload
    }
  });
  if (input.decision !== "ALREADY_CANCELLED") {
    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_booking",
      aggregateId: input.bookingId,
      eventType: "vybe.booking.cancellation_decided.v1",
      deduplicationKey: `vybe.booking.cancellation:${input.cancellationId}:decided`,
      payload
    });
  }
  if (input.decision === "ACCEPTED") {
    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_booking",
      aggregateId: input.bookingId,
      eventType: "vybe.booking.cancelled.v1",
      deduplicationKey: `vybe.booking:${input.bookingId}:cancelled`,
      payload
    });
  }
}

export async function cancelMyVybeBooking(input: {
  bookingId: string;
  customerUserId: string;
  idempotencyKey: string;
  reason: string;
}) {
  const bookingId = input.bookingId.toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  const reason = input.reason.trim().normalize("NFKC");
  if (
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 120 ||
    reason.length < 3 ||
    reason.length > 1000
  ) {
    fail(
      "VYBE_BOOKING_CANCELLATION_REQUEST_INVALID",
      "A valid idempotency key and cancellation reason are required",
      422
    );
  }
  const hash = requestHash({ bookingId, reason });
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.customerUserId },
      select: { status: true }
    });
    if (!user || user.status !== "ACTIVE") {
      fail(
        "UNAUTHENTICATED",
        "An active authenticated customer account is required",
        401
      );
    }

    const advisoryKey = `${input.customerUserId}:${idempotencyKey}`;
    await tx.$queryRaw<Array<{ locked: number }>>(
      Prisma.sql`
        SELECT 1 AS locked
          FROM (
            SELECT pg_advisory_xact_lock(hashtextextended(${advisoryKey}, 0))
          ) AS advisory_lock
      `
    );

    const prior = await tx.vybeBookingCancellation.findUnique({
      where: {
        customerUserId_idempotencyKey: {
          customerUserId: input.customerUserId,
          idempotencyKey
        }
      }
    });
    if (prior) {
      if (prior.requestHash !== hash) {
        fail(
          "IDEMPOTENCY_KEY_REUSED",
          "This cancellation key was used with different request details"
        );
      }
      const booking = await tx.vybeBooking.findFirst({
        where: { id: prior.bookingId, customerUserId: input.customerUserId }
      });
      if (!booking) {
        fail("VYBE_BOOKING_NOT_FOUND", "Booking was not found", 404);
      }
      return { cancellation: prior, booking, replayed: true };
    }

    await lockBooking(tx, bookingId, input.customerUserId);
    const booking = await tx.vybeBooking.findUniqueOrThrow({
      where: { id: bookingId }
    });
    const sourceHoldId = booking.inventoryHoldId ?? booking.timeSlotHoldId;
    if (!sourceHoldId) {
      fail(
        "VYBE_BOOKING_SOURCE_INVARIANT_BROKEN",
        "The booking has no inventory source reference"
      );
    }

    const saveDecision = async (
      decision: CancellationDecision,
      decisionCode: string | null,
      policy: CancellationPolicySnapshot | null,
      decidedAt: Date
    ) => {
      const cancellation = await tx.vybeBookingCancellation.create({
        data: {
          bookingId: booking.id,
          customerUserId: input.customerUserId,
          sourceType: booking.sourceType,
          sourceHoldId,
          idempotencyKey,
          requestHash: hash,
          decision,
          decisionCode,
          reason,
          ...(policy
            ? {
                policyVersion: policy.policyVersion,
                policySnapshot: policy as unknown as Prisma.InputJsonObject
              }
            : {}),
          decidedAt
        }
      });
      await recordDecision(tx, {
        cancellationId: cancellation.id,
        bookingId: booking.id,
        publicReference: booking.publicReference,
        customerUserId: input.customerUserId,
        sourceType: booking.sourceType,
        sourceHoldId,
        decision,
        decisionCode,
        policyVersion: policy?.policyVersion ?? null,
        decidedAt
      });
      return { cancellation, booking, replayed: false };
    };

    if (booking.status === "CANCELLED") {
      return saveDecision(
        "ALREADY_CANCELLED",
        "VYBE_BOOKING_ALREADY_CANCELLED",
        null,
        await databaseNow(tx)
      );
    }
    if (booking.status !== "CONFIRMED") {
      return saveDecision(
        "REJECTED",
        "VYBE_BOOKING_NOT_CANCELLABLE",
        null,
        await databaseNow(tx)
      );
    }

    const parsedPolicy = parsePolicy(booking.acceptedTermsSnapshot);
    if (!parsedPolicy) {
      return saveDecision(
        "REJECTED",
        "VYBE_BOOKING_CANCELLATION_POLICY_UNSUPPORTED",
        null,
        await databaseNow(tx)
      );
    }
    const policy = parsedPolicy.policy;
    if (!policy.customerCancellation.allowed) {
      return saveDecision(
        "REJECTED",
        "VYBE_BOOKING_CANCELLATION_NOT_ALLOWED",
        policy,
        await databaseNow(tx)
      );
    }

    const release = await lockAndValidateInventory(tx, booking);
    const decidedAt = await databaseNow(tx);
    if (
      parsedPolicy.cutoffAt &&
      decidedAt.getTime() >= parsedPolicy.cutoffAt.getTime()
    ) {
      return saveDecision(
        "REJECTED",
        "VYBE_BOOKING_CANCELLATION_CUTOFF_PASSED",
        policy,
        decidedAt
      );
    }

    await releaseInventory(tx, booking.id, release);
    const updated = await tx.vybeBooking.updateMany({
      where: {
        id: booking.id,
        customerUserId: input.customerUserId,
        status: "CONFIRMED"
      },
      data: { status: "CANCELLED", cancelledAt: decidedAt }
    });
    if (updated.count !== 1) {
      fail(
        "VYBE_BOOKING_STATE_RACE",
        "The booking changed while cancellation was being processed"
      );
    }

    const result = await saveDecision("ACCEPTED", null, policy, decidedAt);
    await tx.vybeBookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: "CONFIRMED",
        toStatus: "CANCELLED",
        actorUserId: input.customerUserId,
        actorType: "customer",
        reason,
        metadata: {
          cancellationId: result.cancellation.id,
          policyVersion: policy.policyVersion,
          sourceType: booking.sourceType,
          sourceHoldId
        }
      }
    });
    return {
      ...result,
      booking: {
        ...booking,
        status: "CANCELLED" as const,
        cancelledAt: decidedAt
      }
    };
  });
}

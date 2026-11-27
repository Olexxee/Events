import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertVybeOfferingCanTrade } from "../vybe-inventory/vybe-inventory.service.js";
import { assertVybeOfferingAvailabilityAccess } from "../vybe-time-slots/vybe-time-slots.service.js";
import type {
  ConfirmVybeBookingInput,
  VybeBookingConfirmationVerifier,
  VybeBookingSourceType,
  VybeBookingVerifiedConfirmation
} from "./vybe-bookings.contracts.js";

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

function validateConfirmation(
  value: VybeBookingVerifiedConfirmation
): Prisma.InputJsonObject {
  if (
    !value ||
    (value.kind !== "FREE_ORDER_ACCEPTED" &&
      value.kind !== "PAYMENT_VERIFIED") ||
    typeof value.reference !== "string" ||
    value.reference.trim().length === 0 ||
    !(value.verifiedAt instanceof Date) ||
    !Number.isFinite(value.verifiedAt.getTime()) ||
    !value.quote ||
    typeof value.quote.quoteReference !== "string" ||
    value.quote.quoteReference.trim().length === 0 ||
    !Number.isSafeInteger(value.quote.amountMinor) ||
    value.quote.amountMinor < 0 ||
    typeof value.quote.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.quote.currency)
  ) {
    fail(
      "VYBE_BOOKING_CONFIRMATION_INVALID",
      "The trusted confirmation evidence or commercial quote is invalid",
      422
    );
  }
  if (
    (value.kind === "FREE_ORDER_ACCEPTED" && value.quote.amountMinor !== 0) ||
    (value.kind === "PAYMENT_VERIFIED" && value.quote.amountMinor <= 0)
  ) {
    fail(
      "VYBE_BOOKING_CONFIRMATION_INVALID",
      "Free orders must have a zero-value quote and paid orders must have a positive quote",
      422
    );
  }
  return {
    schemaVersion: 1,
    quoteReference: value.quote.quoteReference,
    amountMinor: value.quote.amountMinor,
    currency: value.quote.currency,
    ...(value.quote.breakdown ? { breakdown: value.quote.breakdown } : {}),
    confirmation: {
      kind: value.kind,
      reference: value.reference,
      verifiedAt: value.verifiedAt.toISOString()
    }
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertTermsSnapshot(value: Prisma.InputJsonObject): void {
  const terms = asObject(value);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof terms.version !== "string" ||
    terms.version.trim().length === 0
  ) {
    fail(
      "VYBE_BOOKING_TERMS_REQUIRED",
      "An accepted, versioned terms snapshot is required",
      422
    );
  }
  if ("cancellationPolicy" in terms) {
    fail(
      "VYBE_BOOKING_POLICY_CLIENT_SUPPLIED",
      "Cancellation policy must be derived from the immutable published offering version",
      422
    );
  }
}

function buildAcceptedTermsSnapshot(
  input: Prisma.InputJsonObject,
  offeringSnapshot: Prisma.InputJsonObject,
  serviceStartsAt: Date | null,
  serviceTimezone: string | null,
  acceptedAt: string
): Prisma.InputJsonObject {
  assertTermsSnapshot(input);
  const content = asObject(asObject(offeringSnapshot).content);
  const policy = asObject(content.cancellationPolicy);
  const customerCancellation = asObject(policy.customerCancellation);
  const policyVersion = policy.policyVersion;
  const allowed = customerCancellation.allowed;
  const cutoffMinutes = customerCancellation.cutoffMinutesBeforeService;
  const timezone = customerCancellation.timezone;
  const displayText = customerCancellation.displayText;

  if (
    typeof policyVersion !== "string" ||
    policyVersion.trim().length === 0 ||
    typeof allowed !== "boolean" ||
    (cutoffMinutes !== null &&
      (!Number.isSafeInteger(cutoffMinutes) ||
        (cutoffMinutes as number) < 0 ||
        (cutoffMinutes as number) > 525600)) ||
    typeof timezone !== "string" ||
    typeof displayText !== "string" ||
    displayText.trim().length < 20 ||
    !Number.isFinite(Date.parse(acceptedAt))
  ) {
    fail(
      "VYBE_BOOKING_CANCELLATION_POLICY_REQUIRED",
      "A valid structured cancellation policy is required on the published offering version",
      422
    );
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    fail(
      "VYBE_BOOKING_CANCELLATION_POLICY_INVALID",
      "The cancellation policy timezone must be a valid IANA timezone",
      422
    );
  }

  if (!allowed && cutoffMinutes !== null) {
    fail(
      "VYBE_BOOKING_CANCELLATION_POLICY_INVALID",
      "A disallowed cancellation policy cannot have a cutoff",
      422
    );
  }
  if (serviceTimezone && serviceTimezone !== timezone) {
    fail(
      "VYBE_BOOKING_CANCELLATION_TIMEZONE_MISMATCH",
      "The cancellation policy timezone must match the booked service timezone",
      422
    );
  }
  if (cutoffMinutes !== null && !serviceStartsAt) {
    fail(
      "VYBE_BOOKING_CANCELLATION_CUTOFF_UNRESOLVED",
      "A relative cancellation cutoff requires a scheduled service start",
      422
    );
  }

  const cutoffAt =
    cutoffMinutes === null
      ? null
      : new Date(
          serviceStartsAt!.getTime() - (cutoffMinutes as number) * 60_000
        ).toISOString();

  return {
    ...input,
    cancellationPolicy: {
      policyVersion,
      customerCancellation: {
        allowed,
        cutoffAt,
        timezone,
        displayText
      },
      acceptedAt
    }
  };
}

function assertReplayMatches(
  booking: {
    customerUserId: string;
    sourceType: VybeBookingSourceType;
    externalOrderItemReference: string | null;
    acceptedTermsSnapshot: Prisma.JsonValue;
    offeringSnapshot: Prisma.JsonValue;
    serviceStartsAt: Date | null;
    timezone: string | null;
    priceQuoteSnapshot: Prisma.JsonValue;
  },
  input: ConfirmVybeBookingInput,
  confirmation: Prisma.InputJsonObject
) {
  const stored = booking.priceQuoteSnapshot as Record<string, unknown>;
  const incoming = confirmation as Record<string, unknown>;
  const storedConfirmation = stored.confirmation as
    Record<string, unknown> | undefined;
  const incomingConfirmation = incoming.confirmation as
    Record<string, unknown> | undefined;
  const sameCommercialEvidence =
    stored.quoteReference === incoming.quoteReference &&
    stored.amountMinor === incoming.amountMinor &&
    stored.currency === incoming.currency &&
    isDeepStrictEqual(stored.breakdown, incoming.breakdown) &&
    stored.schemaVersion === incoming.schemaVersion &&
    storedConfirmation?.kind === incomingConfirmation?.kind &&
    storedConfirmation?.reference === incomingConfirmation?.reference;

  const storedTerms = asObject(booking.acceptedTermsSnapshot);
  const storedPolicy = asObject(storedTerms.cancellationPolicy);
  let expectedTerms: Prisma.InputJsonObject = input.acceptedTermsSnapshot;
  if (Object.keys(storedPolicy).length > 0) {
    try {
      expectedTerms = buildAcceptedTermsSnapshot(
        input.acceptedTermsSnapshot,
        booking.offeringSnapshot as Prisma.InputJsonObject,
        booking.serviceStartsAt,
        booking.timezone,
        typeof storedPolicy.acceptedAt === "string"
          ? storedPolicy.acceptedAt
          : ""
      );
    } catch {
      expectedTerms = {};
    }
  }

  if (
    booking.customerUserId !== input.customerUserId ||
    booking.sourceType !== input.sourceType ||
    booking.externalOrderItemReference !==
      (input.externalOrderItemReference ?? null) ||
    !isDeepStrictEqual(booking.acceptedTermsSnapshot, expectedTerms) ||
    !sameCommercialEvidence
  ) {
    fail(
      "IDEMPOTENCY_KEY_REUSED",
      "This source hold was already converted using different booking or commercial details"
    );
  }
}

async function recordBookingEvent(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    customerUserId: string;
    sourceType: VybeBookingSourceType;
    eventType: string;
    payload: Prisma.InputJsonObject;
  }
) {
  await tx.auditLog.create({
    data: {
      actorId: input.customerUserId,
      actorType: "customer",
      action: "vybe.booking.confirmed",
      resourceType: "vybe_booking",
      resourceId: input.bookingId,
      metadata: input.payload
    }
  });
  await enqueueOutboxMessage(tx, {
    aggregateType: "vybe_booking",
    aggregateId: input.bookingId,
    eventType: input.eventType,
    deduplicationKey: `vybe.booking:${input.bookingId}:confirmed`,
    payload: input.payload
  });
  await tx.vybeBookingStatusHistory.create({
    data: {
      bookingId: input.bookingId,
      fromStatus: null,
      toStatus: "CONFIRMED",
      actorUserId: input.customerUserId,
      actorType: "customer",
      metadata: {
        sourceType: input.sourceType,
        eventType: input.eventType
      }
    }
  });
}

async function recordExpiredSourceHold(
  tx: Prisma.TransactionClient,
  input: {
    sourceType: VybeBookingSourceType;
    sourceHoldId: string;
    aggregateId: string;
  }
) {
  const payload: Prisma.InputJsonObject = {
    holdId: input.sourceHoldId,
    sourceType: input.sourceType,
    outcome: "EXPIRED_BEFORE_BOOKING"
  };
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorType: "system",
      action: "vybe.booking.source_hold_expired",
      resourceType:
        input.sourceType === "QUANTITY_POOL"
          ? "vybe_inventory_hold"
          : "vybe_time_slot_hold",
      resourceId: input.sourceHoldId,
      metadata: payload
    }
  });
  await enqueueOutboxMessage(tx, {
    aggregateType:
      input.sourceType === "QUANTITY_POOL"
        ? "vybe_inventory_pool"
        : "vybe_time_slot_occurrence",
    aggregateId: input.aggregateId,
    eventType: "vybe.booking.source_hold_expired.v1",
    deduplicationKey: `vybe.booking.hold:${input.sourceHoldId}:expired`,
    payload
  });
}

async function loadOfferingVersion(
  tx: Prisma.TransactionClient,
  offeringId: string,
  version: number
) {
  const record = await tx.vybeOfferingVersion.findUnique({
    where: { offeringId_version: { offeringId, version } },
    select: { content: true, version: true }
  });
  if (!record) {
    fail(
      "VYBE_BOOKING_OFFERING_VERSION_MISSING",
      "The offering version associated with this hold is unavailable",
      409
    );
  }
  return {
    schemaVersion: 1,
    offeringId,
    offeringVersion: record.version,
    content: record.content
  } as Prisma.InputJsonObject;
}

function bookingReference(): string {
  return `VYB-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

export async function confirmVybeBookingFromHold(
  input: ConfirmVybeBookingInput,
  verifier: VybeBookingConfirmationVerifier
) {
  assertTermsSnapshot(input.acceptedTermsSnapshot);
  if (
    input.externalOrderItemReference !== undefined &&
    (input.externalOrderItemReference.trim().length === 0 ||
      input.externalOrderItemReference.length > 180)
  ) {
    fail(
      "VYBE_BOOKING_ORDER_REFERENCE_INVALID",
      "The Commerce order-item reference is invalid",
      422
    );
  }

  const prisma = getPrismaClient();
  const initial =
    input.sourceType === "QUANTITY_POOL"
      ? await prisma.vybeInventoryHold.findUnique({
          where: { id: input.sourceHoldId },
          include: { pool: { select: { offeringId: true } } }
        })
      : await prisma.vybeTimeSlotHold.findUnique({
          where: { id: input.sourceHoldId },
          include: {
            occurrence: {
              select: {
                offeringId: true,
                offeringVersion: true,
                timezone: true
              }
            }
          }
        });
  if (!initial)
    fail("VYBE_BOOKING_HOLD_NOT_FOUND", "Source hold was not found", 404);
  if (initial.userId !== input.customerUserId) {
    fail(
      "VYBE_BOOKING_HOLD_FORBIDDEN",
      "Only the hold owner may confirm this booking",
      403
    );
  }

  const existingBooking =
    input.sourceType === "QUANTITY_POOL"
      ? await prisma.vybeBooking.findUnique({
          where: { inventoryHoldId: input.sourceHoldId }
        })
      : await prisma.vybeBooking.findUnique({
          where: { timeSlotHoldId: input.sourceHoldId }
        });
  if (existingBooking) {
    // The verifier is still required on a retry so the retry cannot change
    // the payment/zero-value order evidence associated with this booking.
    const verified = validateConfirmation(await verifier.verify(input));
    assertReplayMatches(existingBooking, input, verified);
    return existingBooking;
  }
  if (initial.status !== "ACTIVE") {
    fail(
      "VYBE_BOOKING_HOLD_NOT_ACTIVE",
      "Only an active, unexpired hold can become a booking"
    );
  }

  const initialOfferingId =
    input.sourceType === "QUANTITY_POOL"
      ? initial.pool.offeringId
      : initial.occurrence.offeringId;
  const initialOfferingVersion =
    input.sourceType === "QUANTITY_POOL"
      ? initial.offeringVersion
      : initial.occurrence.offeringVersion;
  const preflightVersion = await prisma.vybeOfferingVersion.findUnique({
    where: {
      offeringId_version: {
        offeringId: initialOfferingId,
        version: initialOfferingVersion
      }
    },
    select: { content: true, version: true }
  });
  if (!preflightVersion) {
    fail(
      "VYBE_BOOKING_OFFERING_VERSION_MISSING",
      "The offering version associated with this hold is unavailable",
      409
    );
  }
  const preflightOfferingSnapshot = {
    schemaVersion: 1,
    offeringId: initialOfferingId,
    offeringVersion: preflightVersion.version,
    content: preflightVersion.content
  } as Prisma.InputJsonObject;
  const acceptedAt = new Date().toISOString();
  buildAcceptedTermsSnapshot(
    input.acceptedTermsSnapshot,
    preflightOfferingSnapshot,
    input.sourceType === "QUANTITY_POOL" ? null : initial.serviceStartsAt,
    input.sourceType === "QUANTITY_POOL" ? null : initial.occurrence.timezone,
    acceptedAt
  );

  const verifiedConfirmation = await verifier.verify(input);
  const priceQuoteSnapshot = validateConfirmation(verifiedConfirmation);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.customerUserId },
      select: { status: true }
    });
    if (!user || user.status !== "ACTIVE") {
      fail("ACCOUNT_INACTIVE", "An active account is required", 403);
    }

    if (input.sourceType === "QUANTITY_POOL") {
      const source = await tx.vybeInventoryHold.findUnique({
        where: { id: input.sourceHoldId },
        include: {
          pool: { select: { id: true, offeringId: true, status: true } }
        }
      });
      if (!source)
        fail("VYBE_BOOKING_HOLD_NOT_FOUND", "Source hold was not found", 404);
      if (source.userId !== input.customerUserId)
        fail(
          "VYBE_BOOKING_HOLD_FORBIDDEN",
          "Only the hold owner may confirm this booking",
          403
        );

      const offeringLock = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM vybe_offerings WHERE id = ${source.pool.offeringId}::uuid AND status = 'PUBLISHED' FOR SHARE`
      );
      if (!offeringLock.length)
        fail(
          "VYBE_OFFERING_NOT_BOOKABLE",
          "The offering is no longer bookable",
          409
        );
      const offering = await assertVybeOfferingCanTrade(
        tx,
        source.pool.offeringId
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM vybe_inventory_pools WHERE id = ${source.poolId}::uuid FOR UPDATE`
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM vybe_inventory_holds WHERE id = ${source.id}::uuid FOR UPDATE`
      );
      const hold = await tx.vybeInventoryHold.findUniqueOrThrow({
        where: { id: source.id },
        include: { pool: true }
      });
      const replay = await tx.vybeBooking.findUnique({
        where: { inventoryHoldId: hold.id }
      });
      if (replay) {
        assertReplayMatches(replay, input, priceQuoteSnapshot);
        return { booking: replay };
      }
      const lockedAt = new Date();
      if (hold.status !== "ACTIVE")
        fail(
          "VYBE_BOOKING_HOLD_NOT_ACTIVE",
          "The source hold is no longer active"
        );
      if (hold.expiresAt <= lockedAt) {
        await tx.vybeInventoryHold.update({
          where: { id: hold.id },
          data: { status: "EXPIRED" }
        });
        await recordExpiredSourceHold(tx, {
          sourceType: input.sourceType,
          sourceHoldId: hold.id,
          aggregateId: hold.poolId
        });
        return { expired: true as const };
      }
      if (hold.pool.status !== "ACTIVE")
        fail(
          "VYBE_INVENTORY_UNAVAILABLE",
          "The inventory pool is no longer active"
        );
      const nextCommitted = hold.pool.committedQuantity + hold.quantity;
      if (nextCommitted > hold.pool.allocatedQuantity)
        fail(
          "VYBE_INVENTORY_COMMITMENT_CONFLICT",
          "The inventory pool no longer has enough uncommitted allocation"
        );
      const offeringSnapshot = await loadOfferingVersion(
        tx,
        offering.id,
        hold.offeringVersion
      );
      const bookingTermsSnapshot = buildAcceptedTermsSnapshot(
        input.acceptedTermsSnapshot,
        offeringSnapshot,
        null,
        null,
        acceptedAt
      );
      await tx.vybeInventoryHold.update({
        where: { id: hold.id },
        data: { status: "CONVERTED" }
      });
      await tx.vybeInventoryPool.update({
        where: { id: hold.poolId },
        data: { committedQuantity: nextCommitted }
      });
      const booking = await tx.vybeBooking.create({
        data: {
          publicReference: bookingReference(),
          customerUserId: input.customerUserId,
          providerProfileId: offering.providerProfileId,
          providerOrganizationId: offering.providerProfile.organizationId,
          offeringId: offering.id,
          offeringVersion: hold.offeringVersion,
          sourceType: "QUANTITY_POOL",
          inventoryHoldId: hold.id,
          status: "CONFIRMED",
          serviceStartsAt: null,
          serviceEndsAt: null,
          blockedStartsAt: null,
          blockedEndsAt: null,
          timezone: null,
          quantity: hold.quantity,
          resourceId: null,
          offeringSnapshot,
          priceQuoteSnapshot,
          acceptedTermsSnapshot: bookingTermsSnapshot,
          externalOrderItemReference: input.externalOrderItemReference ?? null
        }
      });
      await recordBookingEvent(tx, {
        bookingId: booking.id,
        customerUserId: input.customerUserId,
        sourceType: input.sourceType,
        eventType: "vybe.booking.confirmed.v1",
        payload: {
          bookingId: booking.id,
          publicReference: booking.publicReference,
          sourceType: input.sourceType,
          sourceHoldId: hold.id,
          offeringId: offering.id,
          quantity: hold.quantity
        }
      });
      return { booking };
    }

    const source = await tx.vybeTimeSlotHold.findUnique({
      where: { id: input.sourceHoldId },
      include: {
        occurrence: {
          include: {
            capacity: true,
            resourceGroup: true
          }
        }
      }
    });
    if (!source)
      fail("VYBE_BOOKING_HOLD_NOT_FOUND", "Source hold was not found", 404);
    if (source.userId !== input.customerUserId)
      fail(
        "VYBE_BOOKING_HOLD_FORBIDDEN",
        "Only the hold owner may confirm this booking",
        403
      );
    const offering = await assertVybeOfferingAvailabilityAccess(
      tx,
      source.occurrence.offeringId
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM vybe_time_slot_occurrences WHERE id = ${source.occurrenceId}::uuid FOR UPDATE`
    );
    if (input.sourceType === "EXCLUSIVE_RESOURCE") {
      if (!source.resourceId || !source.occurrence.resourceGroupId) {
        fail(
          "VYBE_BOOKING_SOURCE_MISMATCH",
          "The exclusive hold is missing its resource or resource group"
        );
      }
      const groupLock = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM vybe_time_slot_resource_groups WHERE id = ${source.occurrence.resourceGroupId}::uuid AND is_active = true FOR SHARE`
      );
      if (!groupLock.length) {
        fail(
          "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE",
          "The resource group is no longer active"
        );
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM vybe_time_slot_resources WHERE id = ${source.resourceId}::uuid FOR UPDATE`
      );
      const membershipLock = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id
          FROM vybe_time_slot_resource_group_members
         WHERE resource_group_id = ${source.occurrence.resourceGroupId}::uuid
           AND resource_id = ${source.resourceId}::uuid
           AND (valid_from IS NULL OR valid_from <= ${source.blockedStartsAt})
           AND (valid_until IS NULL OR valid_until >= ${source.blockedEndsAt})
         FOR SHARE`
      );
      if (!membershipLock.length) {
        fail(
          "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE",
          "The held resource is no longer a valid member of its resource group"
        );
      }
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM vybe_time_slot_holds WHERE id = ${source.id}::uuid FOR UPDATE`
    );
    const hold = await tx.vybeTimeSlotHold.findUniqueOrThrow({
      where: { id: source.id },
      include: { occurrence: { include: { capacity: true } } }
    });
    const replay = await tx.vybeBooking.findUnique({
      where: { timeSlotHoldId: hold.id }
    });
    if (replay) {
      assertReplayMatches(replay, input, priceQuoteSnapshot);
      return { booking: replay };
    }
    const lockedAt = new Date();
    if (hold.status !== "ACTIVE")
      fail(
        "VYBE_BOOKING_HOLD_NOT_ACTIVE",
        "The source hold is no longer active"
      );
    if (hold.expiresAt <= lockedAt) {
      await tx.vybeTimeSlotHold.update({
        where: { id: hold.id },
        data: { status: "EXPIRED" }
      });
      if (hold.resourceId) {
        await tx.vybeTimeSlotResourceOccupancy.updateMany({
          where: { sourceHoldId: hold.id, status: "HELD" },
          data: { status: "EXPIRED" }
        });
      }
      await recordExpiredSourceHold(tx, {
        sourceType: input.sourceType,
        sourceHoldId: hold.id,
        aggregateId: hold.occurrenceId
      });
      return { expired: true as const };
    }
    if (hold.occurrence.status !== "ACTIVE")
      fail("VYBE_TIME_SLOT_UNAVAILABLE", "The time slot is no longer active");
    if (hold.occurrence.offeringId !== offering.id)
      fail(
        "VYBE_BOOKING_SOURCE_MISMATCH",
        "The hold no longer matches its offering"
      );
    if (hold.capacityQuantity !== null) {
      if (
        input.sourceType !== "CAPACITY_SESSION" ||
        hold.resourceId !== null ||
        !hold.occurrence.capacity
      )
        fail(
          "VYBE_BOOKING_SOURCE_MISMATCH",
          "The hold is not a capacity-session hold"
        );
      const nextCommitted =
        hold.occurrence.capacity.committedQuantity + hold.capacityQuantity;
      if (nextCommitted > hold.occurrence.capacity.capacity)
        fail(
          "VYBE_TIME_SLOT_CAPACITY_CONFLICT",
          "The time slot no longer has enough uncommitted capacity"
        );
      const offeringSnapshot = await loadOfferingVersion(
        tx,
        offering.id,
        hold.occurrence.offeringVersion
      );
      const bookingTermsSnapshot = buildAcceptedTermsSnapshot(
        input.acceptedTermsSnapshot,
        offeringSnapshot,
        hold.serviceStartsAt,
        hold.occurrence.timezone,
        acceptedAt
      );
      await tx.vybeTimeSlotHold.update({
        where: { id: hold.id },
        data: { status: "CONVERTED" }
      });
      await tx.vybeTimeSlotCapacity.update({
        where: { occurrenceId: hold.occurrenceId },
        data: { committedQuantity: nextCommitted }
      });
      const booking = await tx.vybeBooking.create({
        data: {
          publicReference: bookingReference(),
          customerUserId: input.customerUserId,
          providerProfileId: offering.providerProfileId,
          providerOrganizationId: offering.providerProfile.organizationId,
          offeringId: offering.id,
          offeringVersion: hold.occurrence.offeringVersion,
          sourceType: "CAPACITY_SESSION",
          timeSlotHoldId: hold.id,
          status: "CONFIRMED",
          serviceStartsAt: hold.serviceStartsAt,
          serviceEndsAt: hold.serviceEndsAt,
          blockedStartsAt: hold.blockedStartsAt,
          blockedEndsAt: hold.blockedEndsAt,
          timezone: hold.occurrence.timezone,
          quantity: hold.capacityQuantity,
          resourceId: null,
          offeringSnapshot,
          priceQuoteSnapshot,
          acceptedTermsSnapshot: bookingTermsSnapshot,
          externalOrderItemReference: input.externalOrderItemReference ?? null
        }
      });
      await recordBookingEvent(tx, {
        bookingId: booking.id,
        customerUserId: input.customerUserId,
        sourceType: input.sourceType,
        eventType: "vybe.booking.confirmed.v1",
        payload: {
          bookingId: booking.id,
          publicReference: booking.publicReference,
          sourceType: input.sourceType,
          sourceHoldId: hold.id,
          offeringId: offering.id,
          quantity: hold.capacityQuantity
        }
      });
      return { booking };
    }

    if (input.sourceType !== "EXCLUSIVE_RESOURCE" || !hold.resourceId)
      fail(
        "VYBE_BOOKING_SOURCE_MISMATCH",
        "The hold is not an exclusive-resource hold"
      );
    const resource = await tx.vybeTimeSlotResource.findUnique({
      where: { id: hold.resourceId },
      select: { id: true, isActive: true, providerProfileId: true }
    });
    const group = hold.occurrence.resourceGroupId
      ? await tx.vybeTimeSlotResourceGroup.findUnique({
          where: { id: hold.occurrence.resourceGroupId },
          select: {
            id: true,
            providerProfileId: true,
            offeringId: true,
            isActive: true
          }
        })
      : null;
    if (
      !resource?.isActive ||
      !group?.isActive ||
      group.offeringId !== offering.id ||
      group.providerProfileId !== offering.providerProfileId ||
      resource.providerProfileId !== offering.providerProfileId
    ) {
      fail(
        "VYBE_TIME_SLOT_RESOURCE_UNAVAILABLE",
        "The held resource is no longer eligible"
      );
    }
    const offeringSnapshot = await loadOfferingVersion(
      tx,
      offering.id,
      hold.occurrence.offeringVersion
    );
    const bookingTermsSnapshot = buildAcceptedTermsSnapshot(
      input.acceptedTermsSnapshot,
      offeringSnapshot,
      hold.serviceStartsAt,
      hold.occurrence.timezone,
      acceptedAt
    );
    let occupancy = await tx.vybeTimeSlotResourceOccupancy.findUnique({
      where: { sourceHoldId: hold.id }
    });
    if (!occupancy) {
      // Compatibility bridge for exclusive holds created after the schema
      // migration but before occupancy-aware hold creation was deployed.
      occupancy = await tx.vybeTimeSlotResourceOccupancy.create({
        data: {
          resourceId: hold.resourceId,
          occurrenceId: hold.occurrenceId,
          sourceHoldId: hold.id,
          blockedStartsAt: hold.blockedStartsAt,
          blockedEndsAt: hold.blockedEndsAt
        }
      });
    }
    if (occupancy.status !== "HELD")
      fail(
        "VYBE_BOOKING_OCCUPANCY_NOT_HELD",
        "The exclusive resource is no longer held"
      );
    await tx.vybeTimeSlotHold.update({
      where: { id: hold.id },
      data: { status: "CONVERTED" }
    });
    const booking = await tx.vybeBooking.create({
      data: {
        publicReference: bookingReference(),
        customerUserId: input.customerUserId,
        providerProfileId: offering.providerProfileId,
        providerOrganizationId: offering.providerProfile.organizationId,
        offeringId: offering.id,
        offeringVersion: hold.occurrence.offeringVersion,
        sourceType: "EXCLUSIVE_RESOURCE",
        timeSlotHoldId: hold.id,
        status: "CONFIRMED",
        serviceStartsAt: hold.serviceStartsAt,
        serviceEndsAt: hold.serviceEndsAt,
        blockedStartsAt: hold.blockedStartsAt,
        blockedEndsAt: hold.blockedEndsAt,
        timezone: hold.occurrence.timezone,
        quantity: null,
        resourceId: hold.resourceId,
        offeringSnapshot,
        priceQuoteSnapshot,
        acceptedTermsSnapshot: bookingTermsSnapshot,
        externalOrderItemReference: input.externalOrderItemReference ?? null
      }
    });
    await tx.vybeTimeSlotResourceOccupancy.update({
      where: { id: occupancy.id },
      data: { status: "COMMITTED", bookingId: booking.id }
    });
    await recordBookingEvent(tx, {
      bookingId: booking.id,
      customerUserId: input.customerUserId,
      sourceType: input.sourceType,
      eventType: "vybe.booking.confirmed.v1",
      payload: {
        bookingId: booking.id,
        publicReference: booking.publicReference,
        sourceType: input.sourceType,
        sourceHoldId: hold.id,
        offeringId: offering.id,
        resourceId: hold.resourceId,
        blockedStartsAt: hold.blockedStartsAt.toISOString(),
        blockedEndsAt: hold.blockedEndsAt.toISOString()
      }
    });
    return { booking };
  });

  if ("expired" in result) {
    fail(
      "VYBE_BOOKING_HOLD_EXPIRED",
      "The hold expired before booking confirmation; no booking was created"
    );
  }
  return result.booking;
}

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaClientTypes } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertActiveVerifiedAccount } from "../identity/identity.contracts.js";
import { assertOrganizationAuthority } from "../organizations/organizations.contracts.js";
import { expireAccommodationHoldsInTransaction } from "./vybe-accommodation.holds.db.js";

const PROVIDER_TERMS_VERSION = "vybe-provider-v1";

type Location = { city: string; state: string; country: string };

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

function sameLocation(left: Location, right: Location) {
  return (
    left.city.trim().toLowerCase() === right.city.trim().toLowerCase() &&
    left.state.trim().toLowerCase() === right.state.trim().toLowerCase() &&
    left.country.trim().toLowerCase() === right.country.trim().toLowerCase()
  );
}

function jsonLocations(value: Prisma.JsonValue): Location[] {
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

async function assertProviderAuthority(
  tx: PrismaClientTypes.TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string;
    location?: Location;
    requireActiveAccommodationApproval: boolean;
  }
) {
  await assertActiveVerifiedAccount(tx, input.actorUserId);
  await assertOrganizationAuthority(tx, {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    allowedRoles: ["OWNER", "ADMIN"]
  });

  const organizationLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM organizations
      WHERE id = ${input.organizationId}::uuid AND status = 'ACTIVE'
      FOR SHARE`
  );
  if (organizationLock.length === 0) {
    fail(
      "VYBE_PROVIDER_INACTIVE",
      "The provider organization is not active",
      403
    );
  }

  const profile = await tx.vybeProviderProfile.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true }
  });
  if (!profile) {
    fail(
      "VYBE_PROVIDER_PROFILE_NOT_FOUND",
      "The organization has no Vybe provider profile",
      404
    );
  }

  if (!input.requireActiveAccommodationApproval) return profile.id;
  if (!input.location) {
    fail(
      "VYBE_PROVIDER_LOCATION_REQUIRED",
      "An approved property location is required",
      400
    );
  }

  const now = new Date();
  const approval = await tx.vybeProviderApproval.findFirst({
    where: {
      providerProfileId: profile.id,
      category: "ACCOMMODATION",
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    select: { id: true, locations: true }
  });
  if (!approval) {
    fail(
      "VYBE_PROVIDER_APPROVAL_REQUIRED",
      "An active accommodation provider approval is required",
      403
    );
  }

  if (
    !jsonLocations(approval.locations).some((location) =>
      sameLocation(location, input.location as Location)
    )
  ) {
    fail(
      "VYBE_PROVIDER_LOCATION_NOT_APPROVED",
      "The property is outside the provider's approved accommodation locations",
      403
    );
  }

  const approvalLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_provider_approvals
      WHERE id = ${approval.id}::uuid
        AND status = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      FOR SHARE`
  );
  if (approvalLock.length === 0) {
    fail(
      "VYBE_PROVIDER_APPROVAL_REQUIRED",
      "The accommodation approval is no longer active",
      403
    );
  }

  return profile.id;
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    fail(
      "VYBE_ACCOMMODATION_TIMEZONE_INVALID",
      "A valid IANA timezone is required",
      400
    );
  }
}

function parseAgreedCutoff(value: string, timezone: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.exec(
      value
    );
  if (!match) {
    fail(
      "VYBE_ACCOMMODATION_CUTOFF_INVALID",
      "The agreed cutoff must include a local date-time and explicit UTC offset",
      400
    );
  }

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    fail(
      "VYBE_ACCOMMODATION_CUTOFF_INVALID",
      "The agreed cutoff is not a valid date-time",
      400
    );
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value])
  );
  const localDateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const suppliedLocalDateTime = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}`;
  const actualOffset =
    parts.timeZoneName === "GMT"
      ? "+00:00"
      : parts.timeZoneName?.replace(/^GMT/, "");
  const suppliedOffset = match[5] === "Z" ? "+00:00" : match[5];

  if (
    localDateTime !== suppliedLocalDateTime ||
    actualOffset !== suppliedOffset
  ) {
    fail(
      "VYBE_ACCOMMODATION_CUTOFF_TIMEZONE_MISMATCH",
      "The supplied UTC offset does not resolve to the supplied local time in the property's IANA timezone",
      400
    );
  }

  if (instant.getTime() <= Date.now()) {
    fail(
      "VYBE_ACCOMMODATION_CUTOFF_NOT_FUTURE",
      "A new accommodation allocation requires a future provider-agreed release cutoff",
      400
    );
  }
  return instant;
}

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    fail(
      "VYBE_ACCOMMODATION_DATE_INVALID",
      "Dates must be valid YYYY-MM-DD calendar dates",
      400
    );
  }
  return date;
}

function enumerateNights(startDate: string, endDate: string): string[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start.getTime() >= end.getTime()) {
    fail(
      "VYBE_ACCOMMODATION_DATE_RANGE_INVALID",
      "Check-in/start date must be before the exclusive end date",
      400
    );
  }
  const result: string[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (result.length > 366) {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_TOO_LONG",
        "One allocation may cover at most 366 consecutive room nights",
        400
      );
    }
  }
  return result;
}

async function lockPropertyAndCategory(
  tx: PrismaClientTypes.TransactionClient,
  propertyId: string,
  categoryId: string
) {
  const property = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_accommodation_properties
      WHERE id = ${propertyId}::uuid
      FOR SHARE`
  );
  if (property.length === 0) {
    fail(
      "VYBE_ACCOMMODATION_PROPERTY_NOT_FOUND",
      "Accommodation property was not found",
      404
    );
  }
  const category = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_accommodation_room_categories
      WHERE id = ${categoryId}::uuid
      FOR UPDATE`
  );
  if (category.length === 0) {
    fail(
      "VYBE_ACCOMMODATION_ROOM_CATEGORY_NOT_FOUND",
      "Room category was not found",
      404
    );
  }
}

async function lockNightAnchors(
  tx: PrismaClientTypes.TransactionClient,
  roomCategoryId: string,
  startDate: Date,
  endDate: Date
) {
  await tx.vybeAccommodationNightLock.createMany({
    data: enumerateNights(
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    ).map((stayDate) => ({
      roomCategoryId,
      stayDate: parseDateOnly(stayDate)
    })),
    skipDuplicates: true
  });
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_accommodation_night_locks
      WHERE room_category_id = ${roomCategoryId}::uuid
        AND stay_date >= ${startDate.toISOString().slice(0, 10)}::date
        AND stay_date < ${endDate.toISOString().slice(0, 10)}::date
      ORDER BY stay_date
      FOR UPDATE`
  );
}

async function recordSupplyEvent(
  tx: PrismaClientTypes.TransactionClient,
  input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    aggregateType: string;
    aggregateId?: string;
    eventType: string;
    deduplicationKey: string;
    payload: Prisma.InputJsonObject;
  }
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorUserId,
      actorType: "user",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.payload
    }
  });
  await enqueueOutboxMessage(tx, {
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId ?? input.resourceId,
    eventType: input.eventType,
    deduplicationKey: input.deduplicationKey,
    payload: input.payload
  });
}

export async function createAccommodationProperty(input: {
  organizationId: string;
  actorUserId: string;
  providerPropertyKey: string;
  name: string;
  addressLine?: string | undefined;
  city: string;
  state: string;
  country: string;
  postalCode?: string | undefined;
  timezone: string;
}) {
  assertTimezone(input.timezone);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const providerProfileId = await assertProviderAuthority(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      location: input,
      requireActiveAccommodationApproval: true
    });
    const property = await tx.vybeAccommodationProperty.create({
      data: {
        providerProfileId,
        providerPropertyKey: input.providerPropertyKey,
        name: input.name,
        ...(input.addressLine ? { addressLine: input.addressLine } : {}),
        city: input.city,
        state: input.state,
        country: input.country,
        ...(input.postalCode ? { postalCode: input.postalCode } : {}),
        timezone: input.timezone
      }
    });
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.property_created",
      resourceType: "vybe_accommodation_property",
      resourceId: property.id,
      aggregateType: "vybe_accommodation_property",
      eventType: "vybe.accommodation.property_created.v1",
      deduplicationKey: `vybe.accommodation.property:${property.id}:created`,
      payload: {
        propertyId: property.id,
        providerProfileId,
        providerPropertyKey: property.providerPropertyKey,
        city: property.city,
        state: property.state,
        country: property.country,
        timezone: property.timezone
      }
    });
    return property;
  });
}

export async function listMyAccommodationProperties(actorUserId: string) {
  const prisma = getPrismaClient();
  const profiles = await prisma.vybeProviderProfile.findMany({
    where: {
      organization: {
        status: "ACTIVE",
        memberships: {
          some: {
            userId: actorUserId,
            status: "ACTIVE",
            role: { in: ["OWNER", "ADMIN"] }
          }
        }
      }
    },
    select: { id: true }
  });
  if (profiles.length === 0) return [];
  return prisma.vybeAccommodationProperty.findMany({
    where: { providerProfileId: { in: profiles.map((profile) => profile.id) } },
    include: {
      roomCategories: {
        include: {
          offering: {
            select: { id: true, status: true, currentPublishedVersion: true }
          },
          allocations: {
            include: { nights: { orderBy: { stayDate: "asc" } } },
            orderBy: { createdAt: "desc" }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

export async function createAccommodationRoomCategory(input: {
  propertyId: string;
  actorUserId: string;
  providerCategoryKey: string;
  name: string;
  description?: string | undefined;
  maxOccupancy: number;
  physicalUnitCount: number;
  physicalUnitCountEvidenceReference: string;
  specifications: Prisma.InputJsonObject;
  offeringId: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const property = await tx.vybeAccommodationProperty.findUnique({
      where: { id: input.propertyId },
      include: {
        providerProfile: { select: { organizationId: true, id: true } }
      }
    });
    if (!property) {
      fail(
        "VYBE_ACCOMMODATION_PROPERTY_NOT_FOUND",
        "Accommodation property was not found",
        404
      );
    }
    const providerProfileId = await assertProviderAuthority(tx, {
      organizationId: property.providerProfile.organizationId,
      actorUserId: input.actorUserId,
      location: property,
      requireActiveAccommodationApproval: true
    });
    if (providerProfileId !== property.providerProfileId) {
      fail(
        "VYBE_ACCOMMODATION_FORBIDDEN",
        "The property is outside the provider's scope",
        403
      );
    }
    if (property.status !== "ACTIVE") {
      fail(
        "VYBE_ACCOMMODATION_PROPERTY_INACTIVE",
        "Room categories cannot be added to an inactive property",
        409
      );
    }

    const offering = await tx.vybeOffering.findUnique({
      where: { id: input.offeringId },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          orderBy: { version: "desc" },
          take: 10
        }
      }
    });
    if (
      !offering ||
      offering.providerProfileId !== providerProfileId ||
      offering.category !== "ACCOMMODATION" ||
      offering.status !== "PUBLISHED" ||
      !offering.currentPublishedVersion
    ) {
      fail(
        "VYBE_ACCOMMODATION_OFFERING_INVALID",
        "A published accommodation offering owned by this provider is required",
        400
      );
    }
    const publishedVersion = offering.versions.find(
      (version) => version.version === offering.currentPublishedVersion
    );
    const content = publishedVersion?.content as
      Record<string, unknown> | undefined;
    const offeringLocation = content?.location as
      Record<string, unknown> | undefined;
    const attributes = content?.attributes as
      Record<string, unknown> | undefined;
    if (
      !offeringLocation ||
      !attributes ||
      attributes.category !== "ACCOMMODATION" ||
      String(attributes.roomCategory ?? "")
        .trim()
        .toLowerCase() !== input.name.trim().toLowerCase() ||
      !Number.isInteger(Number(attributes.maxOccupancy)) ||
      Number(attributes.maxOccupancy) < 1 ||
      Number(attributes.maxOccupancy) > input.maxOccupancy ||
      !sameLocation(
        {
          city: String(offeringLocation.city ?? ""),
          state: String(offeringLocation.state ?? ""),
          country: String(offeringLocation.country ?? "")
        },
        property
      )
    ) {
      fail(
        "VYBE_ACCOMMODATION_OFFERING_MISMATCH",
        "The published offering's location, room category, or occupancy promise does not match this room category",
        400
      );
    }

    const category = await tx.vybeAccommodationRoomCategory.create({
      data: {
        providerProfileId,
        propertyId: property.id,
        providerCategoryKey: input.providerCategoryKey,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        maxOccupancy: input.maxOccupancy,
        physicalUnitCount: input.physicalUnitCount,
        physicalUnitCountEvidenceReference:
          input.physicalUnitCountEvidenceReference,
        specifications: input.specifications,
        offeringId: offering.id
      }
    });
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.room_category_created",
      resourceType: "vybe_accommodation_room_category",
      resourceId: category.id,
      aggregateType: "vybe_accommodation_room_category",
      eventType: "vybe.accommodation.room_category_created.v1",
      deduplicationKey: `vybe.accommodation.room_category:${category.id}:created`,
      payload: {
        propertyId: property.id,
        roomCategoryId: category.id,
        offeringId: offering.id,
        physicalUnitCount: input.physicalUnitCount,
        physicalUnitCountEvidenceReference:
          input.physicalUnitCountEvidenceReference,
        maxOccupancy: input.maxOccupancy
      }
    });
    return category;
  });
}

export async function updateAccommodationPhysicalCapacity(input: {
  roomCategoryId: string;
  actorUserId: string;
  physicalUnitCount: number;
  evidenceReference: string;
  reason: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const category = await tx.vybeAccommodationRoomCategory.findUnique({
      where: { id: input.roomCategoryId },
      include: {
        property: true,
        providerProfile: { select: { organizationId: true } }
      }
    });
    if (!category) {
      fail(
        "VYBE_ACCOMMODATION_ROOM_CATEGORY_NOT_FOUND",
        "Room category was not found",
        404
      );
    }
    await assertProviderAuthority(tx, {
      organizationId: category.providerProfile.organizationId,
      actorUserId: input.actorUserId,
      location: category.property,
      requireActiveAccommodationApproval:
        input.physicalUnitCount > (category.physicalUnitCount ?? 0)
    });
    await lockPropertyAndCategory(tx, category.propertyId, category.id);
    const updated = await tx.vybeAccommodationRoomCategory.update({
      where: { id: category.id },
      data: {
        physicalUnitCount: input.physicalUnitCount,
        physicalUnitCountEvidenceReference: input.evidenceReference
      }
    });
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.physical_capacity_updated",
      resourceType: "vybe_accommodation_room_category",
      resourceId: category.id,
      aggregateType: "vybe_accommodation_room_category",
      eventType: "vybe.accommodation.physical_capacity_updated.v1",
      deduplicationKey: `vybe.accommodation.room_category:${category.id}:capacity:${randomUUID()}`,
      payload: {
        roomCategoryId: category.id,
        previousPhysicalUnitCount: category.physicalUnitCount,
        physicalUnitCount: updated.physicalUnitCount,
        evidenceReference: input.evidenceReference,
        reason: input.reason
      }
    });
    return updated;
  });
}

export async function createAccommodationAllocation(input: {
  roomCategoryId: string;
  actorUserId: string;
  startDate: string;
  endDate: string;
  releaseCutoffLocal: string;
  agreementReference: string;
  evidenceReference: string;
  nights: { stayDate: string; allocatedQuantity: number }[];
}) {
  const prisma = getPrismaClient();
  const expectedNights = enumerateNights(input.startDate, input.endDate);
  const quantities = new Map(
    input.nights.map((night) => [night.stayDate, night.allocatedQuantity])
  );
  if (
    quantities.size !== expectedNights.length ||
    expectedNights.some((date) => !quantities.has(date)) ||
    input.nights.length !== expectedNights.length
  ) {
    fail(
      "VYBE_ACCOMMODATION_NIGHTS_INCOMPLETE",
      "An allocation must contain exactly one quantity for every local stay date in its half-open date range",
      400
    );
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.vybeAccommodationRoomCategory.findUnique({
      where: { id: input.roomCategoryId },
      include: {
        property: true,
        providerProfile: { select: { organizationId: true } }
      }
    });
    if (!category) {
      fail(
        "VYBE_ACCOMMODATION_ROOM_CATEGORY_NOT_FOUND",
        "Room category was not found",
        404
      );
    }
    await assertProviderAuthority(tx, {
      organizationId: category.providerProfile.organizationId,
      actorUserId: input.actorUserId,
      location: category.property,
      requireActiveAccommodationApproval: true
    });
    if (category.status !== "ACTIVE" || category.property.status !== "ACTIVE") {
      fail(
        "VYBE_ACCOMMODATION_INACTIVE",
        "Only active properties and room categories can receive new allocations",
        409
      );
    }
    if (
      category.physicalUnitCount === null ||
      !category.physicalUnitCountEvidenceReference
    ) {
      fail(
        "VYBE_ACCOMMODATION_CAPACITY_EVIDENCE_REQUIRED",
        "A positive physical room count and its provider evidence must be recorded before allocating inventory",
        409
      );
    }

    const releaseCutoffAt = parseAgreedCutoff(
      input.releaseCutoffLocal,
      category.property.timezone
    );
    const startDate = parseDateOnly(input.startDate);
    const endDate = parseDateOnly(input.endDate);
    await lockPropertyAndCategory(tx, category.propertyId, category.id);
    await lockNightAnchors(tx, category.id, startDate, endDate);

    const allocation = await tx.vybeAccommodationAllocation.create({
      data: {
        roomCategoryId: category.id,
        startDate,
        endDate,
        releaseCutoffAt,
        releaseCutoffLocal: input.releaseCutoffLocal,
        releaseCutoffTimezone: category.property.timezone,
        agreementReference: input.agreementReference,
        termsVersion: PROVIDER_TERMS_VERSION,
        evidenceReference: input.evidenceReference,
        createdByUserId: input.actorUserId
      }
    });

    await tx.vybeAccommodationAllocationNight.createMany({
      data: expectedNights.map((stayDate) => ({
        allocationId: allocation.id,
        roomCategoryId: category.id,
        stayDate: parseDateOnly(stayDate),
        allocatedQuantity: quantities.get(stayDate) as number
      }))
    });
    const allocationNights = await tx.vybeAccommodationAllocationNight.findMany(
      {
        where: { allocationId: allocation.id },
        orderBy: { stayDate: "asc" }
      }
    );
    await tx.vybeAccommodationAllocationAdjustment.createMany({
      data: allocationNights.map((night) => ({
        allocationNightId: night.id,
        actorUserId: input.actorUserId,
        quantityDelta: night.allocatedQuantity,
        reason: "Initial provider-evidenced allocation",
        evidenceReference: input.evidenceReference
      }))
    });

    const totalAllocated = allocationNights.reduce(
      (total, night) => total + night.allocatedQuantity,
      0
    );
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.allocation_created",
      resourceType: "vybe_accommodation_allocation",
      resourceId: allocation.id,
      aggregateType: "vybe_accommodation_allocation",
      eventType: "vybe.accommodation.allocation_created.v1",
      deduplicationKey: `vybe.accommodation.allocation:${allocation.id}:created`,
      payload: {
        allocationId: allocation.id,
        roomCategoryId: category.id,
        startDate: input.startDate,
        endDate: input.endDate,
        nightCount: allocationNights.length,
        totalAllocated,
        releaseCutoffAt: releaseCutoffAt.toISOString(),
        releaseCutoffLocal: input.releaseCutoffLocal,
        releaseCutoffTimezone: category.property.timezone,
        agreementReference: input.agreementReference,
        evidenceReference: input.evidenceReference
      }
    });

    return tx.vybeAccommodationAllocation.findUniqueOrThrow({
      where: { id: allocation.id },
      include: { nights: { orderBy: { stayDate: "asc" } } }
    });
  });
}

export async function adjustAccommodationAllocationNight(input: {
  allocationNightId: string;
  actorUserId: string;
  quantityDelta: number;
  reason: string;
  evidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const initial = await tx.vybeAccommodationAllocationNight.findUnique({
      where: { id: input.allocationNightId },
      include: {
        allocation: {
          include: {
            roomCategory: {
              include: {
                property: true,
                providerProfile: { select: { organizationId: true } }
              }
            }
          }
        }
      }
    });
    if (!initial) {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_NIGHT_NOT_FOUND",
        "Allocation night was not found",
        404
      );
    }
    await assertProviderAuthority(tx, {
      organizationId:
        initial.allocation.roomCategory.providerProfile.organizationId,
      actorUserId: input.actorUserId,
      location: initial.allocation.roomCategory.property,
      requireActiveAccommodationApproval: input.quantityDelta > 0
    });
    if (
      initial.allocation.status !== "ACTIVE" &&
      initial.allocation.status !== "PAUSED"
    ) {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_NOT_ADJUSTABLE",
        "Released allocations cannot be adjusted",
        409
      );
    }

    await lockPropertyAndCategory(
      tx,
      initial.allocation.roomCategory.propertyId,
      initial.roomCategoryId
    );
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM vybe_accommodation_night_locks
        WHERE room_category_id = ${initial.roomCategoryId}::uuid
          AND stay_date = ${initial.stayDate}::date
        FOR UPDATE`
    );
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM vybe_accommodation_allocation_nights
        WHERE id = ${initial.id}::uuid
        FOR UPDATE`
    );
    await expireAccommodationHoldsInTransaction(
      tx,
      initial.roomCategoryId
    );
    const current = await tx.vybeAccommodationAllocationNight.findUniqueOrThrow(
      {
        where: { id: initial.id }
      }
    );
    if (
      input.quantityDelta > 0 &&
      initial.allocation.releaseCutoffAt.getTime() <= Date.now()
    ) {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_CUTOFF_PASSED",
        "Inventory cannot be added after the provider-agreed release cutoff",
        409
      );
    }
    const nextQuantity = current.allocatedQuantity + input.quantityDelta;
    if (nextQuantity <= 0) {
      fail(
        "VYBE_ACCOMMODATION_ZERO_ALLOCATION",
        "Use the allocation release operation to reclaim the final allocated room",
        400
      );
    }

    const updated = await tx.vybeAccommodationAllocationNight.update({
      where: { id: current.id },
      data: { allocatedQuantity: nextQuantity }
    });
    const adjustment = await tx.vybeAccommodationAllocationAdjustment.create({
      data: {
        allocationNightId: current.id,
        actorUserId: input.actorUserId,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        evidenceReference: input.evidenceReference
      }
    });
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.allocation_adjusted",
      resourceType: "vybe_accommodation_allocation_night",
      resourceId: current.id,
      aggregateType: "vybe_accommodation_allocation",
      aggregateId: current.allocationId,
      eventType: "vybe.accommodation.allocation_adjusted.v1",
      deduplicationKey: `vybe.accommodation.allocation_adjustment:${adjustment.id}`,
      payload: {
        allocationId: current.allocationId,
        allocationNightId: current.id,
        stayDate: current.stayDate.toISOString().slice(0, 10),
        previousAllocatedQuantity: current.allocatedQuantity,
        allocatedQuantity: updated.allocatedQuantity,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        evidenceReference: input.evidenceReference
      }
    });
    return { allocationNight: updated, adjustment };
  });
}

export async function releaseAccommodationAllocation(input: {
  allocationId: string;
  actorUserId: string;
  reason: string;
  evidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const allocation = await tx.vybeAccommodationAllocation.findUnique({
      where: { id: input.allocationId },
      include: {
        roomCategory: {
          include: {
            property: true,
            providerProfile: { select: { organizationId: true } }
          }
        },
        nights: { orderBy: { stayDate: "asc" } }
      }
    });
    if (!allocation) {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_NOT_FOUND",
        "Accommodation allocation was not found",
        404
      );
    }
    await assertProviderAuthority(tx, {
      organizationId: allocation.roomCategory.providerProfile.organizationId,
      actorUserId: input.actorUserId,
      location: allocation.roomCategory.property,
      requireActiveAccommodationApproval: false
    });
    if (allocation.status === "RELEASED") {
      fail(
        "VYBE_ACCOMMODATION_ALLOCATION_ALREADY_RELEASED",
        "This allocation has already been released",
        409
      );
    }

    await lockPropertyAndCategory(
      tx,
      allocation.roomCategory.propertyId,
      allocation.roomCategoryId
    );
    if (allocation.nights.length > 0) {
      const first = allocation.nights[0]?.stayDate;
      const last = allocation.nights[allocation.nights.length - 1]?.stayDate;
      if (first && last) {
        const endExclusive = new Date(last);
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM vybe_accommodation_night_locks
            WHERE room_category_id = ${allocation.roomCategoryId}::uuid
              AND stay_date >= ${first.toISOString().slice(0, 10)}::date
              AND stay_date < ${endExclusive.toISOString().slice(0, 10)}::date
            ORDER BY stay_date
            FOR UPDATE`
        );
      }
    }
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM vybe_accommodation_allocations
        WHERE id = ${allocation.id}::uuid
        FOR UPDATE`
    );
    await expireAccommodationHoldsInTransaction(
      tx,
      allocation.roomCategoryId
    );
    const updated = await tx.vybeAccommodationAllocation.update({
      where: { id: allocation.id },
      data: { status: "RELEASED" }
    });
    await recordSupplyEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.accommodation.allocation_released",
      resourceType: "vybe_accommodation_allocation",
      resourceId: allocation.id,
      aggregateType: "vybe_accommodation_allocation",
      eventType: "vybe.accommodation.allocation_released.v1",
      deduplicationKey: `vybe.accommodation.allocation:${allocation.id}:released`,
      payload: {
        allocationId: allocation.id,
        roomCategoryId: allocation.roomCategoryId,
        reason: input.reason,
        evidenceReference: input.evidenceReference
      }
    });
    return updated;
  });
}

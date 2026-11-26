import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertOrganizationAuthority } from "../organizations/organizations.contracts.js";

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

function parseInstant(value: string, timezone: string): Date {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    fail("VYBE_TIME_SLOT_INVALID_INSTANT", "A valid service timestamp is required", 400);
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(instant);
  } catch {
    fail("VYBE_TIME_SLOT_INVALID_TIMEZONE", "A valid IANA timezone is required", 400);
  }
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (
    !match ||
    local.year !== match[1] ||
    local.month !== match[2] ||
    local.day !== match[3] ||
    local.hour !== match[4] ||
    local.minute !== match[5] ||
    local.second !== match[6]
  ) {
    fail(
      "VYBE_TIME_SLOT_TIMEZONE_OFFSET_MISMATCH",
      "The timestamp's explicit UTC offset does not match the supplied IANA timezone at that instant",
      400
    );
  }
  return instant;
}

function parseValidityInstant(value: string): Date {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    fail("VYBE_TIME_SLOT_INVALID_VALIDITY_WINDOW", "A valid ISO-8601 validity timestamp is required", 400);
  }
  return instant;
}

function validateWindow(validFrom?: Date, validUntil?: Date) {
  if (validFrom && validUntil && validFrom >= validUntil) {
    fail(
      "VYBE_TIME_SLOT_INVALID_VALIDITY_WINDOW",
      "validFrom must be earlier than validUntil",
      400
    );
  }
}

async function assertOfferingSetupAccess(
  tx: Prisma.TransactionClient,
  offeringId: string,
  actorUserId: string
) {
  const offering = await tx.vybeOffering.findUnique({
    where: { id: offeringId },
    include: {
      providerProfile: {
        include: {
          organization: { select: { id: true, status: true } },
          approvals: {
            where: {
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
            }
          }
        }
      },
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" }
      }
    }
  });
  if (
    !offering ||
    offering.status !== "PUBLISHED" ||
    !offering.currentPublishedVersion
  ) {
    fail(
      "VYBE_OFFERING_NOT_PUBLISHED",
      "Time-slot setup requires a published offering",
      404
    );
  }
  const organizationId = offering.providerProfile.organizationId;
  await assertOrganizationAuthority(tx, {
    organizationId,
    userId: actorUserId,
    allowedRoles: ["OWNER", "ADMIN"]
  });
  if (offering.providerProfile.organization.status !== "ACTIVE") {
    fail("VYBE_PROVIDER_INACTIVE", "The provider organization is not active", 403);
  }
  const approval = offering.providerProfile.approvals.find(
    (item) => item.category === offering.category
  );
  if (!approval) {
    fail(
      "VYBE_PROVIDER_APPROVAL_REQUIRED",
      "An active category-scoped provider approval is required",
      403
    );
  }
  const approvalLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_provider_approvals WHERE id = ${approval.id}::uuid AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()) FOR SHARE`
  );
  if (approvalLock.length === 0) {
    fail("VYBE_PROVIDER_APPROVAL_REQUIRED", "Provider approval is no longer active", 403);
  }
  const organizationLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM organizations WHERE id = ${organizationId}::uuid AND status = 'ACTIVE' FOR SHARE`
  );
  if (organizationLock.length === 0) {
    fail("VYBE_PROVIDER_INACTIVE", "The provider organization is no longer active", 403);
  }
  const activationLock = await tx.$queryRaw<Array<{ category: string }>>(
    Prisma.sql`SELECT category FROM vybe_category_activations WHERE category = ${offering.category}::vybe_category AND is_active = true FOR SHARE`
  );
  if (activationLock.length === 0) {
    fail("VYBE_CATEGORY_NOT_ACTIVE", "This Vybe category has not passed its launch gates");
  }
  const version = offering.versions.find(
    (item) => item.version === offering.currentPublishedVersion
  );
  const content = version?.content as Record<string, unknown> | undefined;
  const location = content?.location as Record<string, unknown> | undefined;
  const locations = Array.isArray(approval.locations) ? approval.locations : [];
  const approved = locations.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return (
      String(item.city ?? "").toLowerCase() === String(location?.city ?? "").toLowerCase() &&
      String(item.state ?? "").toLowerCase() === String(location?.state ?? "").toLowerCase() &&
      String(item.country ?? "").toLowerCase() === String(location?.country ?? "").toLowerCase()
    );
  });
  if (!approved) {
    fail(
      "VYBE_PROVIDER_LOCATION_NOT_APPROVED",
      "The offering location is outside the provider's approved locations",
      403
    );
  }
  return offering;
}

async function recordSetupEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    aggregateType: string;
    eventType: string;
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
    aggregateId: input.resourceId,
    eventType: input.eventType,
    deduplicationKey: `vybe.time_slot:${input.resourceId}:${randomUUID()}`,
    payload: input.payload
  });
}

export async function createTimeSlotOccurrence(input: {
  offeringId: string;
  actorUserId: string;
  inventoryMode: "CAPACITY" | "EXCLUSIVE";
  timezone: string;
  serviceStartsAt: string;
  serviceEndsAt: string;
  preBufferSeconds: number;
  postBufferSeconds: number;
  capacity?: number;
  resourceGroupId?: string;
  supplyEvidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const offering = await assertOfferingSetupAccess(tx, input.offeringId, input.actorUserId);
    const serviceStartsAt = parseInstant(input.serviceStartsAt, input.timezone);
    const serviceEndsAt = parseInstant(input.serviceEndsAt, input.timezone);
    if (serviceStartsAt >= serviceEndsAt) {
      fail("VYBE_TIME_SLOT_INVALID_INTERVAL", "Service end must be after service start", 400);
    }
    const blockedStartsAt = new Date(serviceStartsAt.getTime() - input.preBufferSeconds * 1000);
    const blockedEndsAt = new Date(serviceEndsAt.getTime() + input.postBufferSeconds * 1000);
    let resourceGroupId: string | undefined;
    if (input.inventoryMode === "EXCLUSIVE") {
      if (!input.resourceGroupId) {
        fail("VYBE_TIME_SLOT_RESOURCE_GROUP_REQUIRED", "An exclusive occurrence requires a resource group", 400);
      }
      const group = await tx.vybeTimeSlotResourceGroup.findFirst({
        where: {
          id: input.resourceGroupId,
          offeringId: offering.id,
          providerProfileId: offering.providerProfileId,
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: blockedStartsAt } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: blockedEndsAt } }] }
          ]
        },
        select: { id: true }
      });
      if (!group) {
        fail(
          "VYBE_TIME_SLOT_RESOURCE_GROUP_INVALID",
          "The resource group must be active, belong to this offering, and cover the full blocked interval",
          400
        );
      }
      resourceGroupId = group.id;
    }
    const occurrence = await tx.vybeTimeSlotOccurrence.create({
      data: {
        offeringId: offering.id,
        offeringVersion: offering.currentPublishedVersion,
        inventoryMode: input.inventoryMode,
        timezone: input.timezone,
        serviceStartsAt,
        serviceEndsAt,
        preBufferSeconds: input.preBufferSeconds,
        postBufferSeconds: input.postBufferSeconds,
        blockedStartsAt,
        blockedEndsAt,
        ...(resourceGroupId ? { resourceGroupId } : {}),
        ...(input.inventoryMode === "CAPACITY"
          ? { capacity: { create: { capacity: input.capacity as number } } }
          : {})
      },
      include: { capacity: true, resourceGroup: true }
    });
    await recordSetupEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.time_slot_occurrence.created",
      resourceType: "vybe_time_slot_occurrence",
      resourceId: occurrence.id,
      aggregateType: "vybe_time_slot_occurrence",
      eventType: "vybe.time_slot_occurrence.created.v1",
      payload: {
        offeringId: offering.id,
        offeringVersion: offering.currentPublishedVersion,
        inventoryMode: input.inventoryMode,
        timezone: input.timezone,
        serviceStartsAt: serviceStartsAt.toISOString(),
        serviceEndsAt: serviceEndsAt.toISOString(),
        blockedStartsAt: blockedStartsAt.toISOString(),
        blockedEndsAt: blockedEndsAt.toISOString(),
        supplyEvidenceReference: input.supplyEvidenceReference
      }
    });
    return occurrence;
  });
}

export async function createTimeSlotResourceGroup(input: {
  offeringId: string;
  actorUserId: string;
  name: string;
  validFrom?: string;
  validUntil?: string;
  supplyEvidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const offering = await assertOfferingSetupAccess(tx, input.offeringId, input.actorUserId);
    const validFrom = input.validFrom ? parseValidityInstant(input.validFrom) : undefined;
    const validUntil = input.validUntil ? parseValidityInstant(input.validUntil) : undefined;
    validateWindow(validFrom, validUntil);
    const group = await tx.vybeTimeSlotResourceGroup.create({
      data: {
        providerProfileId: offering.providerProfileId,
        offeringId: offering.id,
        name: input.name,
        ...(validFrom ? { validFrom } : {}),
        ...(validUntil ? { validUntil } : {})
      }
    });
    await recordSetupEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.time_slot_resource_group.created",
      resourceType: "vybe_time_slot_resource_group",
      resourceId: group.id,
      aggregateType: "vybe_time_slot_resource_group",
      eventType: "vybe.time_slot_resource_group.created.v1",
      payload: {
        offeringId: offering.id,
        providerProfileId: offering.providerProfileId,
        name: group.name,
        supplyEvidenceReference: input.supplyEvidenceReference
      }
    });
    return group;
  });
}

export async function createTimeSlotResource(input: {
  offeringId: string;
  actorUserId: string;
  providerResourceKey: string;
  name: string;
  supplyEvidenceReference: string;
}) {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      const offering = await assertOfferingSetupAccess(tx, input.offeringId, input.actorUserId);
      const resource = await tx.vybeTimeSlotResource.create({
        data: {
          providerProfileId: offering.providerProfileId,
          providerResourceKey: input.providerResourceKey,
          name: input.name
        }
      });
      await recordSetupEvent(tx, {
        actorUserId: input.actorUserId,
        action: "vybe.time_slot_resource.created",
        resourceType: "vybe_time_slot_resource",
        resourceId: resource.id,
        aggregateType: "vybe_time_slot_resource",
        eventType: "vybe.time_slot_resource.created.v1",
        payload: {
          providerProfileId: offering.providerProfileId,
          offeringId: offering.id,
          providerResourceKey: resource.providerResourceKey,
          supplyEvidenceReference: input.supplyEvidenceReference
        }
      });
      return resource;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("VYBE_TIME_SLOT_RESOURCE_KEY_EXISTS", "This provider resource key is already in use", 409);
    }
    throw error;
  }
}

export async function addTimeSlotResourceGroupMember(input: {
  groupId: string;
  resourceId: string;
  actorUserId: string;
  validFrom?: string;
  validUntil?: string;
  supplyEvidenceReference: string;
}) {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      const group = await tx.vybeTimeSlotResourceGroup.findUnique({
        where: { id: input.groupId },
        include: { offering: { include: { providerProfile: true } } }
      });
      if (!group) fail("VYBE_TIME_SLOT_RESOURCE_GROUP_NOT_FOUND", "Resource group was not found", 404);
      await assertOrganizationAuthority(tx, {
        organizationId: group.offering.providerProfile.organizationId,
        userId: input.actorUserId,
        allowedRoles: ["OWNER", "ADMIN"]
      });
      await assertOfferingSetupAccess(tx, group.offeringId, input.actorUserId);
      const resource = await tx.vybeTimeSlotResource.findUnique({
        where: { id: input.resourceId }
      });
      if (!resource || resource.providerProfileId !== group.providerProfileId || !resource.isActive || !group.isActive) {
        fail("VYBE_TIME_SLOT_RESOURCE_SCOPE_INVALID", "The resource and active group must belong to the same provider", 400);
      }
      const validFrom = input.validFrom ? parseInstant(input.validFrom, "UTC") : undefined;
      const validUntil = input.validUntil ? parseInstant(input.validUntil, "UTC") : undefined;
      validateWindow(validFrom, validUntil);
      if (
        (group.validFrom && (!validFrom || validFrom < group.validFrom)) ||
        (group.validUntil && (!validUntil || validUntil > group.validUntil))
      ) {
        fail("VYBE_TIME_SLOT_MEMBERSHIP_OUTSIDE_GROUP", "Membership validity must be contained within the resource group's validity window", 400);
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM vybe_time_slot_resources WHERE id = ${resource.id}::uuid FOR UPDATE`
      );
      const memberships = await tx.vybeTimeSlotResourceGroupMember.findMany({
        where: { resourceId: resource.id, resourceGroupId: { not: group.id } }
      });
      const overlaps = memberships.some((membership) => {
        const startA = validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
        const endA = validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
        const startB = membership.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
        const endB = membership.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
        return startA < endB && startB < endA;
      });
      if (overlaps) {
        fail(
          "VYBE_TIME_SLOT_RESOURCE_MEMBERSHIP_OVERLAP",
          "A concrete resource cannot be allocated to overlapping resource-group validity windows",
          409
        );
      }
      const member = await tx.vybeTimeSlotResourceGroupMember.create({
        data: {
          resourceGroupId: group.id,
          resourceId: resource.id,
          ...(validFrom ? { validFrom } : {}),
          ...(validUntil ? { validUntil } : {})
        }
      });
      await recordSetupEvent(tx, {
        actorUserId: input.actorUserId,
        action: "vybe.time_slot_resource_group.member_added",
        resourceType: "vybe_time_slot_resource_group_member",
        resourceId: member.id,
        aggregateType: "vybe_time_slot_resource_group",
        eventType: "vybe.time_slot_resource_group.member_added.v1",
        payload: {
          groupId: group.id,
          resourceId: resource.id,
          validFrom: validFrom?.toISOString() ?? null,
          validUntil: validUntil?.toISOString() ?? null,
          supplyEvidenceReference: input.supplyEvidenceReference
        }
      });
      return member;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("VYBE_TIME_SLOT_MEMBERSHIP_EXISTS", "This resource is already a member of the group", 409);
    }
    throw error;
  }
}

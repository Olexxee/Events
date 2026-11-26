import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertOrganizationAuthority } from "../organizations/organizations.contracts.js";

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

async function lockPool(tx: Prisma.TransactionClient, poolId: string) {
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_inventory_pools WHERE id = ${poolId}::uuid FOR UPDATE`
  );
}

async function assertOfferingCanTrade(
  tx: Prisma.TransactionClient,
  offeringId: string
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
        orderBy: { version: "desc" },
        take: 1
      }
    }
  });
  if (
    !offering ||
    offering.status !== "PUBLISHED" ||
    !offering.currentPublishedVersion
  ) {
    fail(
      "VYBE_OFFERING_NOT_BOOKABLE",
      "Only published Vybe offerings can have controlled inventory",
      404
    );
  }
  if (offering.providerProfile.organization.status !== "ACTIVE") {
    fail(
      "VYBE_PROVIDER_INACTIVE",
      "The provider organization is not active",
      403
    );
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
    Prisma.sql`SELECT id FROM vybe_provider_approvals WHERE id = ${approval.id}::uuid AND status = 'ACTIVE' FOR SHARE`
  );
  if (approvalLock.length === 0) {
    fail("VYBE_PROVIDER_APPROVAL_REQUIRED", "The provider approval is no longer active", 403);
  }
  const organizationLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM organizations WHERE id = ${offering.providerProfile.organization.id}::uuid AND status = 'ACTIVE' FOR SHARE`
  );
  if (organizationLock.length === 0) {
    fail("VYBE_PROVIDER_INACTIVE", "The provider organization is no longer active", 403);
  }
  const activation = await tx.vybeCategoryActivation.findUnique({
    where: { category: offering.category },
    select: { isActive: true }
  });
  if (!activation?.isActive) {
    fail(
      "VYBE_CATEGORY_NOT_ACTIVE",
      "This Vybe category has not passed its launch gates"
    );
  }
  const activationLock = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM vybe_category_activations WHERE category = ${offering.category}::vybe_category AND is_active = true FOR SHARE`
  );
  if (activationLock.length === 0) {
    fail("VYBE_CATEGORY_NOT_ACTIVE", "This Vybe category has been deactivated");
  }
  const version = offering.versions.find(
    (item) => item.version === offering.currentPublishedVersion
  );
  const content = version?.content as Record<string, unknown> | undefined;
  const location = content?.location as Record<string, unknown> | undefined;
  const approvedLocations = Array.isArray(approval.locations)
    ? approval.locations
    : [];
  const locationApproved = approvedLocations.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return false;
    const item = entry as Record<string, unknown>;
    return (
      String(item.city ?? "").toLowerCase() ===
        String(location?.city ?? "").toLowerCase() &&
      String(item.state ?? "").toLowerCase() ===
        String(location?.state ?? "").toLowerCase() &&
      String(item.country ?? "").toLowerCase() ===
        String(location?.country ?? "").toLowerCase()
    );
  });
  if (!locationApproved) {
    fail(
      "VYBE_PROVIDER_LOCATION_NOT_APPROVED",
      "The offering location is outside the provider's approved scope",
      403
    );
  }
  return offering;
}

async function recordInventoryEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string | null;
    actorType?: string;
    action: string;
    resourceType: string;
    resourceId: string;
    aggregateType: string;
    eventType: string;
    key: string;
    payload: Prisma.InputJsonObject;
  }
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorUserId,
      actorType: input.actorType ?? "user",
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
    deduplicationKey: input.key,
    payload: input.payload
  });
}

async function expirePoolHolds(
  tx: Prisma.TransactionClient,
  poolId: string,
  now: Date
) {
  const expired = await tx.vybeInventoryHold.findMany({
    where: { poolId, status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, quantity: true, poolId: true }
  });
  if (expired.length === 0) return;
  await tx.vybeInventoryHold.updateMany({
    where: { id: { in: expired.map((hold) => hold.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED" }
  });
  for (const hold of expired) {
    await recordInventoryEvent(tx, {
      actorUserId: null,
      actorType: "system",
      action: "vybe.inventory.hold_expired",
      resourceType: "vybe_inventory_hold",
      resourceId: hold.id,
      aggregateType: "vybe_inventory_pool",
      eventType: "vybe.inventory.hold_expired.v1",
      key: `vybe.inventory.hold:${hold.id}:expired`,
      payload: { holdId: hold.id, poolId: hold.poolId, quantity: hold.quantity }
    });
  }
}

export async function createInventoryPool(input: {
  organizationId: string;
  offeringId: string;
  actorUserId: string;
  allocatedQuantity: number;
  reason: string;
  evidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await assertOrganizationAuthority(tx, {
      organizationId: input.organizationId,
      userId: input.actorUserId,
      allowedRoles: ["OWNER", "ADMIN"]
    });
    const offering = await assertOfferingCanTrade(tx, input.offeringId);
    if (offering.providerProfile.organizationId !== input.organizationId) {
      fail(
        "VYBE_INVENTORY_FORBIDDEN",
        "Only the offering's provider organization may allocate its inventory",
        403
      );
    }
    const pool = await tx.vybeInventoryPool.create({
      data: {
        offeringId: input.offeringId,
        allocatedQuantity: input.allocatedQuantity,
        allocations: {
          create: {
            actorUserId: input.actorUserId,
            quantityDelta: input.allocatedQuantity,
            reason: input.reason,
            evidenceReference: input.evidenceReference
          }
        }
      }
    });
    await recordInventoryEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.inventory.pool_created",
      resourceType: "vybe_inventory_pool",
      resourceId: pool.id,
      aggregateType: "vybe_inventory_pool",
      eventType: "vybe.inventory.pool_created.v1",
      key: `vybe.inventory.pool:${pool.id}:created`,
      payload: {
        offeringId: input.offeringId,
        allocatedQuantity: input.allocatedQuantity
      }
    });
    return pool;
  });
}

export async function adjustInventoryAllocation(input: {
  poolId: string;
  actorUserId: string;
  quantityDelta: number;
  reason: string;
  evidenceReference: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const initialPool = await tx.vybeInventoryPool.findUnique({
      where: { id: input.poolId },
      include: { offering: { include: { providerProfile: true } } }
    });
    if (!initialPool)
      fail(
        "VYBE_INVENTORY_POOL_NOT_FOUND",
        "Inventory pool was not found",
        404
      );
    await assertOrganizationAuthority(tx, {
      organizationId: initialPool.offering.providerProfile.organizationId,
      userId: input.actorUserId,
      allowedRoles: ["OWNER", "ADMIN"]
    });
    await assertOfferingCanTrade(tx, initialPool.offeringId);
    await lockPool(tx, input.poolId);
    const pool = await tx.vybeInventoryPool.findUniqueOrThrow({
      where: { id: input.poolId },
      include: { offering: { include: { providerProfile: true } } }
    });
    const now = new Date();
    await expirePoolHolds(tx, pool.id, now);
    const active = await tx.vybeInventoryHold.aggregate({
      where: { poolId: pool.id, status: "ACTIVE", expiresAt: { gt: now } },
      _sum: { quantity: true }
    });
    const nextAllocation = pool.allocatedQuantity + input.quantityDelta;
    const protectedQuantity =
      pool.committedQuantity + (active._sum.quantity ?? 0);
    if (nextAllocation < protectedQuantity || nextAllocation < 0) {
      fail(
        "VYBE_ALLOCATION_BELOW_COMMITMENTS",
        "Allocation cannot be reduced below active holds and confirmed commitments"
      );
    }
    const updated = await tx.vybeInventoryPool.update({
      where: { id: pool.id },
      data: { allocatedQuantity: nextAllocation }
    });
    await tx.vybeInventoryAllocation.create({
      data: {
        poolId: pool.id,
        actorUserId: input.actorUserId,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        evidenceReference: input.evidenceReference
      }
    });
    await recordInventoryEvent(tx, {
      actorUserId: input.actorUserId,
      action: "vybe.inventory.allocation_adjusted",
      resourceType: "vybe_inventory_pool",
      resourceId: pool.id,
      aggregateType: "vybe_inventory_pool",
      eventType: "vybe.inventory.allocation_adjusted.v1",
      key: `vybe.inventory.pool:${pool.id}:allocation:${randomUUID()}`,
      payload: {
        quantityDelta: input.quantityDelta,
        allocatedQuantity: nextAllocation,
        reason: input.reason,
        evidenceReference: input.evidenceReference
      }
    });
    return updated;
  });
}

export async function getInventoryAvailability(offeringId: string) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const offering = await assertOfferingCanTrade(tx, offeringId);
    const pool = await tx.vybeInventoryPool.findUnique({
      where: { offeringId }
    });
    if (!pool || pool.status !== "ACTIVE") {
      return {
        offeringId,
        category: offering.category,
        availableQuantity: 0,
        inventoryEnabled: false
      };
    }
    const now = new Date();
    const active = await tx.vybeInventoryHold.aggregate({
      where: { poolId: pool.id, status: "ACTIVE", expiresAt: { gt: now } },
      _sum: { quantity: true }
    });
    return {
      offeringId,
      category: offering.category,
      allocatedQuantity: pool.allocatedQuantity,
      heldQuantity: active._sum.quantity ?? 0,
      committedQuantity: pool.committedQuantity,
      availableQuantity: Math.max(
        0,
        pool.allocatedQuantity -
          pool.committedQuantity -
          (active._sum.quantity ?? 0)
      ),
      inventoryEnabled: true
    };
  });
}

export async function createInventoryHold(input: {
  offeringId: string;
  userId: string;
  quantity: number;
  idempotencyKey: string;
}) {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { status: true }
      });
      if (!user || user.status !== "ACTIVE")
        fail("ACCOUNT_INACTIVE", "An active account is required", 403);
      const offering = await assertOfferingCanTrade(tx, input.offeringId);
      const pool = await tx.vybeInventoryPool.findUnique({
        where: { offeringId: input.offeringId }
      });
      if (!pool || pool.status !== "ACTIVE")
        fail(
          "VYBE_INVENTORY_UNAVAILABLE",
          "This offering has no active controlled inventory"
        );
      await lockPool(tx, pool.id);
      const existing = await tx.vybeInventoryHold.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      if (existing) {
        if (
          existing.poolId !== pool.id ||
          existing.quantity !== input.quantity
        ) {
          fail(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different inventory hold"
          );
        }
        if (existing.status === "ACTIVE" && existing.expiresAt > new Date())
          return existing;
        fail(
          "VYBE_HOLD_NO_LONGER_ACTIVE",
          "This idempotent hold has expired or been released"
        );
      }
      const now = new Date();
      await expirePoolHolds(tx, pool.id, now);
      const active = await tx.vybeInventoryHold.aggregate({
        where: { poolId: pool.id, status: "ACTIVE", expiresAt: { gt: now } },
        _sum: { quantity: true }
      });
      const available =
        pool.allocatedQuantity -
        pool.committedQuantity -
        (active._sum.quantity ?? 0);
      if (input.quantity > available) {
        fail(
          "VYBE_INSUFFICIENT_INVENTORY",
          "The requested quantity is no longer available"
        );
      }
      const policy = await tx.vybeInventoryPolicy.findUnique({
        where: { category: offering.category }
      });
      const holdDurationSeconds = policy?.holdDurationSeconds ?? 600;
      const hold = await tx.vybeInventoryHold.create({
        data: {
          poolId: pool.id,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          quantity: input.quantity,
          expiresAt: new Date(now.getTime() + holdDurationSeconds * 1000)
        }
      });
      await recordInventoryEvent(tx, {
        actorUserId: input.userId,
        action: "vybe.inventory.hold_created",
        resourceType: "vybe_inventory_hold",
        resourceId: hold.id,
        aggregateType: "vybe_inventory_pool",
        eventType: "vybe.inventory.hold_created.v1",
        key: `vybe.inventory.hold:${hold.id}:created`,
        payload: {
          holdId: hold.id,
          offeringId: input.offeringId,
          quantity: input.quantity,
          expiresAt: hold.expiresAt.toISOString()
        }
      });
      return { ...hold, offeringCategory: offering.category };
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

export async function releaseInventoryHold(input: {
  holdId: string;
  userId: string;
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const hold = await tx.vybeInventoryHold.findUnique({
      where: { id: input.holdId }
    });
    if (!hold) fail("VYBE_HOLD_NOT_FOUND", "Inventory hold was not found", 404);
    if (hold.userId !== input.userId)
      fail("VYBE_HOLD_FORBIDDEN", "Only the hold owner may release it", 403);
    await lockPool(tx, hold.poolId);
    const current = await tx.vybeInventoryHold.findUniqueOrThrow({
      where: { id: hold.id }
    });
    if (current.status !== "ACTIVE") return current;
    const status = current.expiresAt <= new Date() ? "EXPIRED" : "RELEASED";
    const updated = await tx.vybeInventoryHold.update({
      where: { id: current.id },
      data: { status }
    });
    await recordInventoryEvent(tx, {
      actorUserId: input.userId,
      action:
        status === "EXPIRED"
          ? "vybe.inventory.hold_expired"
          : "vybe.inventory.hold_released",
      resourceType: "vybe_inventory_hold",
      resourceId: updated.id,
      aggregateType: "vybe_inventory_pool",
      eventType:
        status === "EXPIRED"
          ? "vybe.inventory.hold_expired.v1"
          : "vybe.inventory.hold_released.v1",
      key: `vybe.inventory.hold:${updated.id}:${status.toLowerCase()}`,
      payload: {
        holdId: updated.id,
        poolId: updated.poolId,
        quantity: updated.quantity
      }
    });
    return updated;
  });
}

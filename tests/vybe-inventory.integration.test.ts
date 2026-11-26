import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  adjustInventoryAllocation,
  createInventoryHold,
  createInventoryPool,
  getInventoryAvailability
} from "../src/modules/vybe-inventory/vybe-inventory.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Vybe quantity inventory PostgreSQL integration", () => {
  let ownerId: string;
  let organizationId: string;
  let offeringId: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await prisma.vybeInventoryHold.deleteMany();
    await prisma.vybeInventoryAllocation.deleteMany();
    await prisma.vybeInventoryPool.deleteMany();
    await prisma.vybeOfferingVersion.deleteMany();
    await prisma.vybeOffering.deleteMany();
    await prisma.vybeProviderApproval.deleteMany();
    await prisma.vybeProviderApplicationLocation.deleteMany();
    await prisma.vybeProviderReview.deleteMany();
    await prisma.vybeProviderEvidence.deleteMany();
    await prisma.vybeProviderApplication.deleteMany();
    await prisma.vybeProviderProfile.deleteMany();
    await prisma.vybeCategoryActivation.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const owner = await prisma.user.create({
      data: { email: `vybe-inventory-${crypto.randomUUID()}@events.test` }
    });
    ownerId = owner.id;
    const organization = await prisma.organization.create({
      data: {
        name: "Vybe Inventory Provider",
        slug: `vybe-inventory-${crypto.randomUUID()}`,
        createdById: ownerId,
        memberships: {
          create: { userId: ownerId, role: "OWNER", status: "ACTIVE" }
        }
      }
    });
    organizationId = organization.id;
    const profile = await prisma.vybeProviderProfile.create({
      data: { organizationId }
    });
    const application = await prisma.vybeProviderApplication.create({
      data: {
        organizationId,
        applicantUserId: ownerId,
        category: "DRINKS",
        serviceDescription: "Approved provider inventory integration fixture",
        supplyAuthorityStatement: "The provider controls the stock allocated to Vybe.",
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
        approvedByUserId: ownerId
      }
    });
    await prisma.vybeCategoryActivation.create({
      data: {
        category: "DRINKS",
        isActive: true,
        checklist: [],
        reason: "Integration fixture"
      }
    });
    const offering = await prisma.vybeOffering.create({
      data: {
        providerProfileId: profile.id,
        category: "DRINKS",
        status: "PUBLISHED",
        currentPublishedVersion: 1,
        createdByUserId: ownerId,
        versions: {
          create: {
            version: 1,
            status: "PUBLISHED",
            content: {
              title: "Drinks package",
              location: { city: "Lagos", state: "Lagos", country: "Nigeria" },
              attributes: { category: "DRINKS" }
            },
            createdByUserId: ownerId,
            publishedAt: new Date()
          }
        }
      }
    });
    offeringId = offering.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("creates a provider-owned allocation with an auditable allocation record", async () => {
    const pool = await createInventoryPool({
      organizationId,
      offeringId,
      actorUserId: ownerId,
      allocatedQuantity: 8,
      reason: "Initial secured inventory allocation"
    });
    expect(pool.allocatedQuantity).toBe(8);
    expect(await prisma.vybeInventoryAllocation.count({ where: { poolId: pool.id } })).toBe(1);
  });

  it("prevents concurrent holds from exceeding the allocated quantity", async () => {
    await createInventoryPool({
      organizationId,
      offeringId,
      actorUserId: ownerId,
      allocatedQuantity: 1,
      reason: "One secured unit for concurrency test"
    });
    const results = await Promise.allSettled([
      createInventoryHold({ offeringId, userId: ownerId, quantity: 1, idempotencyKey: crypto.randomUUID() }),
      createInventoryHold({ offeringId, userId: ownerId, quantity: 1, idempotencyKey: crypto.randomUUID() })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const availability = await getInventoryAvailability(offeringId);
    expect(availability.availableQuantity).toBe(0);
  });

  it("reuses the same idempotent hold and rejects a changed payload", async () => {
    await createInventoryPool({
      organizationId,
      offeringId,
      actorUserId: ownerId,
      allocatedQuantity: 3,
      reason: "Idempotency fixture allocation"
    });
    const idempotencyKey = crypto.randomUUID();
    const first = await createInventoryHold({ offeringId, userId: ownerId, quantity: 1, idempotencyKey });
    const retry = await createInventoryHold({ offeringId, userId: ownerId, quantity: 1, idempotencyKey });
    expect(retry.id).toBe(first.id);
    await expect(createInventoryHold({ offeringId, userId: ownerId, quantity: 2, idempotencyKey })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED"
    });
  });

  it("expires stale holds synchronously before allocating capacity again", async () => {
    await createInventoryPool({
      organizationId,
      offeringId,
      actorUserId: ownerId,
      allocatedQuantity: 1,
      reason: "Expiry fixture allocation"
    });
    const old = await createInventoryHold({
      offeringId,
      userId: ownerId,
      quantity: 1,
      idempotencyKey: crypto.randomUUID()
    });
    await prisma.vybeInventoryHold.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const next = await createInventoryHold({
      offeringId,
      userId: ownerId,
      quantity: 1,
      idempotencyKey: crypto.randomUUID()
    });
    expect(next.status).toBe("ACTIVE");
    expect(await prisma.vybeInventoryHold.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: "EXPIRED"
    });
  });

  it("rejects allocation reductions below active holds", async () => {
    const pool = await createInventoryPool({
      organizationId,
      offeringId,
      actorUserId: ownerId,
      allocatedQuantity: 2,
      reason: "Allocation reduction fixture"
    });
    await createInventoryHold({
      offeringId,
      userId: ownerId,
      quantity: 2,
      idempotencyKey: crypto.randomUUID()
    });
    await expect(adjustInventoryAllocation({
      poolId: pool.id,
      actorUserId: ownerId,
      quantityDelta: -1,
      reason: "Attempted reduction below protected stock"
    })).rejects.toMatchObject({
      code: "VYBE_ALLOCATION_BELOW_COMMITMENTS"
    });
  });
});

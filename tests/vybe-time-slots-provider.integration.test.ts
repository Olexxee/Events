import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  addTimeSlotResourceGroupMember,
  createTimeSlotOccurrence,
  createTimeSlotResource,
  createTimeSlotResourceGroup
} from "../src/modules/vybe-time-slots/vybe-time-slots.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Vybe time-slot provider setup PostgreSQL integration", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createProviderFixture(label: string) {
    const user = await prisma.user.create({
      data: { email: `vybe-time-slots-${label}-${crypto.randomUUID()}@events.test` }
    });
    const organization = await prisma.organization.create({
      data: {
        name: `Vybe Time Slot Provider ${label}`,
        slug: `vybe-time-slots-${label}-${crypto.randomUUID()}`,
        createdById: user.id,
        memberships: {
          create: { userId: user.id, role: "OWNER", status: "ACTIVE" }
        }
      }
    });
    const profile = await prisma.vybeProviderProfile.create({
      data: { organizationId: organization.id }
    });
    const application = await prisma.vybeProviderApplication.create({
      data: {
        organizationId: organization.id,
        applicantUserId: user.id,
        category: "DRINKS",
        serviceDescription: "Approved time-slot provider integration fixture",
        supplyAuthorityStatement: "The provider controls the physical resources and service supply.",
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
        approvedByUserId: user.id
      }
    });
    await prisma.vybeCategoryActivation.upsert({
      where: { category: "DRINKS" },
      create: {
        category: "DRINKS",
        isActive: true,
        checklist: [],
        reason: "Time-slot provider integration fixture"
      },
      update: {
        isActive: true,
        checklist: [],
        reason: "Time-slot provider integration fixture"
      }
    });
    const offering = await prisma.vybeOffering.create({
      data: {
        providerProfileId: profile.id,
        category: "DRINKS",
        status: "PUBLISHED",
        currentPublishedVersion: 1,
        createdByUserId: user.id,
        versions: {
          create: {
            version: 1,
            status: "PUBLISHED",
            content: {
              title: "Private drinks service",
              location: { city: "Lagos", state: "Lagos", country: "Nigeria" },
              attributes: { category: "DRINKS" }
            },
            createdByUserId: user.id,
            publishedAt: new Date()
          }
        }
      }
    });
    return {
      userId: user.id,
      organizationId: organization.id,
      profileId: profile.id,
      offeringId: offering.id
    };
  }

  it("creates capacity occurrences with immutable offering and interval snapshots", async () => {
    const provider = await createProviderFixture("capacity");
    const occurrence = await createTimeSlotOccurrence({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      inventoryMode: "CAPACITY",
      timezone: "Africa/Lagos",
      serviceStartsAt: "2027-01-15T18:00:00+01:00",
      serviceEndsAt: "2027-01-15T19:00:00+01:00",
      preBufferSeconds: 900,
      postBufferSeconds: 600,
      capacity: 24,
      supplyEvidenceReference: "provider-supply-register:capacity-24"
    });

    expect(occurrence).toMatchObject({
      offeringId: provider.offeringId,
      offeringVersion: 1,
      inventoryMode: "CAPACITY",
      timezone: "Africa/Lagos",
      preBufferSeconds: 900,
      postBufferSeconds: 600,
      capacity: { capacity: 24, committedQuantity: 0 },
      resourceGroupId: null
    });
    expect(occurrence.blockedStartsAt.toISOString()).toBe("2027-01-15T16:45:00.000Z");
    expect(occurrence.blockedEndsAt.toISOString()).toBe("2027-01-15T18:10:00.000Z");
    expect(
      await prisma.auditLog.findFirst({
        where: {
          resourceId: occurrence.id,
          action: "vybe.time_slot_occurrence.created",
          metadata: { path: ["supplyEvidenceReference"], equals: "provider-supply-register:capacity-24" }
        }
      })
    ).not.toBeNull();
  });

  it("creates exclusive occurrences only against a same-offering group with provider resources", async () => {
    const provider = await createProviderFixture("exclusive");
    const group = await createTimeSlotResourceGroup({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      name: "Main lounge",
      supplyEvidenceReference: "provider-floor-plan:main-lounge"
    });
    const resource = await createTimeSlotResource({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      providerResourceKey: `lounge-${crypto.randomUUID()}`,
      name: "Lounge A",
      supplyEvidenceReference: "provider-asset-register:lounge-a"
    });
    const member = await addTimeSlotResourceGroupMember({
      groupId: group.id,
      resourceId: resource.id,
      actorUserId: provider.userId,
      supplyEvidenceReference: "provider-allocation-sheet:lounge-a"
    });
    const occurrence = await createTimeSlotOccurrence({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      inventoryMode: "EXCLUSIVE",
      timezone: "Africa/Lagos",
      serviceStartsAt: "2027-02-01T20:00:00+01:00",
      serviceEndsAt: "2027-02-01T22:00:00+01:00",
      preBufferSeconds: 300,
      postBufferSeconds: 900,
      resourceGroupId: group.id,
      supplyEvidenceReference: "provider-booking-register:exclusive-slot"
    });

    expect(member.resourceId).toBe(resource.id);
    expect(occurrence).toMatchObject({
      inventoryMode: "EXCLUSIVE",
      resourceGroupId: group.id,
      capacity: null
    });
  });

  it("rejects timestamps whose explicit offset conflicts with the IANA timezone", async () => {
    const provider = await createProviderFixture("timezone");
    await expect(
      createTimeSlotOccurrence({
        offeringId: provider.offeringId,
        actorUserId: provider.userId,
        inventoryMode: "CAPACITY",
        timezone: "Africa/Lagos",
        serviceStartsAt: "2027-01-15T18:00:00Z",
        serviceEndsAt: "2027-01-15T19:00:00Z",
        preBufferSeconds: 0,
        postBufferSeconds: 0,
        capacity: 4,
        supplyEvidenceReference: "provider-supply-register:timezone"
      })
    ).rejects.toMatchObject({
      code: "VYBE_TIME_SLOT_TIMEZONE_OFFSET_MISMATCH"
    });
  });

  it("rejects resources owned by another provider", async () => {
    const first = await createProviderFixture("owner-a");
    const second = await createProviderFixture("owner-b");
    const group = await createTimeSlotResourceGroup({
      offeringId: first.offeringId,
      actorUserId: first.userId,
      name: "Provider A group",
      supplyEvidenceReference: "provider-a-floor-plan:group"
    });
    const resource = await createTimeSlotResource({
      offeringId: second.offeringId,
      actorUserId: second.userId,
      providerResourceKey: `provider-b-resource-${crypto.randomUUID()}`,
      name: "Provider B asset",
      supplyEvidenceReference: "provider-b-asset-register:asset"
    });

    await expect(
      addTimeSlotResourceGroupMember({
        groupId: group.id,
        resourceId: resource.id,
        actorUserId: first.userId,
        supplyEvidenceReference: "provider-a-allocation-sheet:invalid"
      })
    ).rejects.toMatchObject({
      code: "VYBE_TIME_SLOT_RESOURCE_SCOPE_INVALID"
    });
  });

  it("prevents one physical resource from being allocated to overlapping groups", async () => {
    const provider = await createProviderFixture("overlap");
    const firstGroup = await createTimeSlotResourceGroup({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      name: "Group one",
      supplyEvidenceReference: "provider-layout:group-one"
    });
    const secondGroup = await createTimeSlotResourceGroup({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      name: "Group two",
      supplyEvidenceReference: "provider-layout:group-two"
    });
    const resource = await createTimeSlotResource({
      offeringId: provider.offeringId,
      actorUserId: provider.userId,
      providerResourceKey: `shared-resource-${crypto.randomUUID()}`,
      name: "Shared physical table",
      supplyEvidenceReference: "provider-asset-register:shared-table"
    });
    await addTimeSlotResourceGroupMember({
      groupId: firstGroup.id,
      resourceId: resource.id,
      actorUserId: provider.userId,
      validFrom: "2027-03-01T00:00:00Z",
      validUntil: "2027-03-02T00:00:00Z",
      supplyEvidenceReference: "provider-allocation:group-one"
    });

    await expect(
      addTimeSlotResourceGroupMember({
        groupId: secondGroup.id,
        resourceId: resource.id,
        actorUserId: provider.userId,
        validFrom: "2027-03-01T12:00:00Z",
        validUntil: "2027-03-03T00:00:00Z",
        supplyEvidenceReference: "provider-allocation:group-two"
      })
    ).rejects.toMatchObject({
      code: "VYBE_TIME_SLOT_RESOURCE_MEMBERSHIP_OVERLAP"
    });
  });
});

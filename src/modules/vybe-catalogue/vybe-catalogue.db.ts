import type { Prisma, VybeCategory } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";
import { assertOrganizationAuthority } from "../organizations/organizations.contracts.js";
import type { VybeOfferingContent } from "./vybe-catalogue.validators.js";

const requiredChecks: Record<VybeCategory, string[]> = {
  ACCOMMODATION: ["provider_and_supply_authority", "secured_room_category_allocation", "nightly_capacity_and_concurrency", "occupancy_checkin_checkout", "overbooking_reaccommodation", "customer_terms_and_pricing", "support_operations", "safety_licensing_privacy_review"],
  DINING: ["provider_and_supply_authority", "secured_table_or_prepared_quantity", "service_period_capacity_controls", "party_size_and_turnaround", "customer_terms_and_pricing", "support_operations", "food_safety_and_privacy_review"],
  DRINKS: ["provider_and_supply_authority", "secured_quantity_allocation", "service_window_capacity_controls", "responsible_service_procedures", "customer_terms_and_pricing", "support_operations", "age_licensing_and_safety_review"],
  TABLES_LOUNGES: ["provider_and_supply_authority", "secured_resource_or_capacity_pool", "occupancy_limits", "time_window_overlap_prevention", "customer_terms_and_pricing", "support_operations", "safety_privacy_review"],
  VIP_EXPERIENCES: ["provider_and_supply_authority", "secured_capacity_or_slots", "inclusions_and_exclusions", "eligibility_controls", "ticketing_admission_separation", "customer_terms_and_pricing", "support_operations", "safety_privacy_review"],
  OTHER_SERVICES: ["provider_and_supply_authority", "documented_scarce_resource", "booking_constraint_and_capacity", "fulfilment_proof", "exception_process", "customer_terms_and_pricing", "support_operations", "category_safety_compliance_review"]
};

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

async function assertProviderScope(tx: Prisma.TransactionClient, profileId: string, category: VybeCategory, location: VybeOfferingContent["location"]) {
  const approval = await tx.vybeProviderApproval.findFirst({
    where: {
      providerProfileId: profileId,
      category,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { id: true, locations: true }
  });
  if (!approval) fail("VYBE_PROVIDER_APPROVAL_REQUIRED", "An active approval for this category is required before managing a live offering", 403);
  const approvedLocations = Array.isArray(approval.locations) ? approval.locations : [];
  const matches = approvedLocations.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return String(item.city ?? "").toLowerCase() === location.city.toLowerCase()
      && String(item.state ?? "").toLowerCase() === location.state.toLowerCase()
      && String(item.country ?? "").toLowerCase() === location.country.toLowerCase();
  });
  if (!matches) fail("VYBE_PROVIDER_LOCATION_NOT_APPROVED", "This offering location is outside the provider's approved locations", 403);
}

export async function createOfferingDraft(input: { organizationId: string; actorUserId: string; category: VybeCategory; content: VybeOfferingContent }) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await assertOrganizationAuthority(tx, { organizationId: input.organizationId, userId: input.actorUserId, allowedRoles: ["OWNER", "ADMIN"] });
    const profile = await tx.vybeProviderProfile.findUnique({ where: { organizationId: input.organizationId }, select: { id: true } });
    if (!profile) fail("VYBE_PROVIDER_PROFILE_NOT_FOUND", "The organization has no Vybe provider profile", 404);
    await assertProviderScope(tx, profile.id, input.category, input.content.location);
    const offering = await tx.vybeOffering.create({
      data: {
        providerProfileId: profile.id,
        category: input.category,
        createdByUserId: input.actorUserId,
        versions: { create: { version: 1, content: input.content as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId } }
      },
      include: { versions: true }
    });
    await tx.auditLog.create({ data: { actorId: input.actorUserId, actorType: "user", action: "vybe.offering.draft_created", resourceType: "vybe_offering", resourceId: offering.id, metadata: { category: input.category, version: 1 } } });
    await enqueueOutboxMessage(tx, { aggregateType: "vybe_offering", aggregateId: offering.id, eventType: "vybe.offering.draft_created.v1", deduplicationKey: `vybe.offering:${offering.id}:draft:1`, payload: { offeringId: offering.id, category: input.category, version: 1 } });
    return offering;
  });
}

export async function updateOfferingDraft(input: { offeringId: string; actorUserId: string; content: VybeOfferingContent }) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const offering = await tx.vybeOffering.findUnique({ where: { id: input.offeringId }, include: { providerProfile: true, versions: { orderBy: { version: "desc" } } } });
    if (!offering) fail("VYBE_OFFERING_NOT_FOUND", "Offering was not found", 404);
    if (offering.status === "ARCHIVED") fail("VYBE_OFFERING_ARCHIVED", "Archived offerings cannot be edited");
    const membership = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: offering.providerProfile.organizationId, userId: input.actorUserId } }, select: { role: true, status: true, organization: { select: { status: true } } } });
    if (!membership || membership.status !== "ACTIVE" || membership.organization.status !== "ACTIVE" || !["OWNER", "ADMIN"].includes(membership.role)) fail("ORGANIZATION_AUTHORITY_REQUIRED", "An active organization owner or admin is required", 403);
    if (input.content.attributes.category !== offering.category) fail("VYBE_OFFERING_CATEGORY_MISMATCH", "Offering content must match its original category", 400);
    await assertProviderScope(tx, offering.providerProfileId, offering.category, input.content.location);
    let draft = offering.versions.find((version) => version.status === "DRAFT");
    if (draft) {
      draft = await tx.vybeOfferingVersion.update({ where: { id: draft.id }, data: { content: input.content as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId } });
    } else {
      const version = (offering.versions[0]?.version ?? 0) + 1;
      draft = await tx.vybeOfferingVersion.create({ data: { offeringId: offering.id, version, content: input.content as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId } });
    }
    await tx.auditLog.create({ data: { actorId: input.actorUserId, actorType: "user", action: "vybe.offering.draft_updated", resourceType: "vybe_offering", resourceId: offering.id, metadata: { category: offering.category, version: draft.version } } });
    await enqueueOutboxMessage(tx, { aggregateType: "vybe_offering", aggregateId: offering.id, eventType: "vybe.offering.draft_updated.v1", deduplicationKey: `vybe.offering:${offering.id}:draft-update:${draft.id}:${draft.createdAt.toISOString()}`, payload: { offeringId: offering.id, category: offering.category, version: draft.version } });
    return { offeringId: offering.id, version: draft };
  });
}

export async function publishOffering(input: { offeringId: string; actorUserId: string }) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const offering = await tx.vybeOffering.findUnique({ where: { id: input.offeringId }, include: { providerProfile: true, versions: { where: { status: "DRAFT" }, orderBy: { version: "desc" }, take: 1 } } });
    if (!offering) fail("VYBE_OFFERING_NOT_FOUND", "Offering was not found", 404);
    const membership = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: offering.providerProfile.organizationId, userId: input.actorUserId } }, select: { role: true, status: true, organization: { select: { status: true } } } });
    if (!membership || membership.status !== "ACTIVE" || membership.organization.status !== "ACTIVE" || !["OWNER", "ADMIN"].includes(membership.role)) fail("ORGANIZATION_AUTHORITY_REQUIRED", "An active organization owner or admin is required", 403);
    const draft = offering.versions[0];
    if (!draft) fail("VYBE_OFFERING_DRAFT_REQUIRED", "Create or update a draft before publishing");
    const content = draft.content as unknown as VybeOfferingContent;
    await assertProviderScope(tx, offering.providerProfileId, offering.category, content.location);
    const activation = await tx.vybeCategoryActivation.findUnique({ where: { category: offering.category }, select: { isActive: true } });
    if (!activation?.isActive) fail("VYBE_CATEGORY_NOT_ACTIVE", "This Vybe category has not passed its staged launch gates");
    await tx.vybeOfferingVersion.update({ where: { id: draft.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const updated = await tx.vybeOffering.update({ where: { id: offering.id }, data: { status: "PUBLISHED", currentPublishedVersion: draft.version } });
    await tx.auditLog.create({ data: { actorId: input.actorUserId, actorType: "user", action: "vybe.offering.published", resourceType: "vybe_offering", resourceId: offering.id, metadata: { category: offering.category, version: draft.version } } });
    await enqueueOutboxMessage(tx, { aggregateType: "vybe_offering", aggregateId: offering.id, eventType: "vybe.offering.published.v1", deduplicationKey: `vybe.offering:${offering.id}:published:${draft.version}`, payload: { offeringId: offering.id, category: offering.category, version: draft.version } });
    return updated;
  });
}

export async function activateCategory(input: { category: VybeCategory; actorUserId: string; active: boolean; reason: string; checks: { key: string; completed: true; evidenceReference: string; notes: string }[] }) {
  const missing = requiredChecks[input.category].filter((key) => !input.checks.some((check) => check.key === key && check.completed === true));
  const unexpected = input.checks.filter((check) => !requiredChecks[input.category].includes(check.key));
  if (input.active && (missing.length || unexpected.length || input.checks.length !== requiredChecks[input.category].length)) {
    fail("VYBE_CATEGORY_LAUNCH_GATES_INCOMPLETE", `Launch checklist must contain exactly the required checks. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.map((item) => item.key).join(", ") || "none"}`, 400);
  }
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const previous = await tx.vybeCategoryActivation.findUnique({ where: { category: input.category } });
    const activation = await tx.vybeCategoryActivation.upsert({
      where: { category: input.category },
      create: { category: input.category, isActive: input.active, checklist: input.checks as unknown as Prisma.InputJsonValue, reason: input.reason, activatedByUserId: input.active ? input.actorUserId : null, activatedAt: input.active ? new Date() : null },
      update: { isActive: input.active, checklist: input.checks as unknown as Prisma.InputJsonValue, reason: input.reason, activatedByUserId: input.active ? input.actorUserId : null, activatedAt: input.active ? new Date() : null }
    });
    await tx.auditLog.create({ data: { actorId: input.actorUserId, actorType: "user", action: input.active ? "vybe.category.activated" : "vybe.category.deactivated", resourceType: "vybe_category", resourceId: input.category, metadata: { reason: input.reason, previousActive: previous?.isActive ?? false, checks: input.checks.map((check) => check.key) } } });
    await enqueueOutboxMessage(tx, { aggregateType: "vybe_category", aggregateId: input.category, eventType: input.active ? "vybe.category.activated.v1" : "vybe.category.deactivated.v1", deduplicationKey: `vybe.category:${input.category}:activation:${activation.updatedAt.toISOString()}`, payload: { category: input.category, active: input.active, reason: input.reason } });
    return activation;
  });
}

export async function listPublicOfferings(input: { category?: VybeCategory; city?: string; state?: string }) {
  const prisma = getPrismaClient();
  const active = await prisma.vybeCategoryActivation.findMany({ where: { isActive: true }, select: { category: true } });
  const activeCategories = active.map((item) => item.category).filter((category) => !input.category || category === input.category);
  if (activeCategories.length === 0) return [];
  const offerings = await prisma.vybeOffering.findMany({
    where: { status: "PUBLISHED", category: { in: activeCategories } },
    include: { versions: true, providerProfile: { select: { organization: { select: { name: true, status: true } }, approvals: { where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { category: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return offerings.flatMap((offering) => {
    const version = offering.versions.find((item) => item.version === offering.currentPublishedVersion && item.status === "PUBLISHED");
    if (!version || offering.providerProfile.organization.status !== "ACTIVE") return [];
    if (!offering.providerProfile.approvals.some((approval) => approval.category === offering.category)) return [];
    const content = version.content as Record<string, unknown>;
    const loc = content.location as Record<string, unknown> | undefined;
    if (input.city && String(loc?.city ?? "").toLowerCase() !== input.city.toLowerCase()) return [];
    if (input.state && String(loc?.state ?? "").toLowerCase() !== input.state.toLowerCase()) return [];
    return [{ id: offering.id, category: offering.category, providerName: offering.providerProfile.organization.name, version: version.version, content: version.content, publishedAt: version.publishedAt }];
  });
}

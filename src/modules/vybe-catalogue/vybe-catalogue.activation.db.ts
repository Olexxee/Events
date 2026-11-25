import { randomUUID } from "node:crypto";
import type { Prisma, VybeCategory } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";

const requiredChecks: Record<VybeCategory, string> = {
  ACCOMMODATION: "provider_and_supply_authority,secured_room_category_allocation,nightly_capacity_and_concurrency,occupancy_checkin_checkout,overbooking_reaccommodation,customer_terms_and_pricing,support_operations,safety_licensing_privacy_review",
  DINING: "provider_and_supply_authority,secured_table_or_prepared_quantity,service_period_capacity_controls,party_size_and_turnaround,customer_terms_and_pricing,support_operations,food_safety_and_privacy_review",
  DRINKS: "provider_and_supply_authority,secured_quantity_allocation,service_window_capacity_controls,responsible_service_procedures,customer_terms_and_pricing,support_operations,age_licensing_and_safety_review",
  TABLES_LOUNGES: "provider_and_supply_authority,secured_resource_or_capacity_pool,occupancy_limits,time_window_overlap_prevention,customer_terms_and_pricing,support_operations,safety_privacy_review",
  VIP_EXPERIENCES: "provider_and_supply_authority,secured_capacity_or_slots,inclusions_and_exclusions,eligibility_controls,ticketing_admission_separation,customer_terms_and_pricing,support_operations,safety_privacy_review",
  OTHER_SERVICES: "provider_and_supply_authority,documented_scarce_resource,booking_constraint_and_capacity,fulfilment_proof,exception_process,customer_terms_and_pricing,support_operations,category_safety_compliance_review"
};

function fail(code: string, message: string, status = 409): never {
  throw new AppError(code, message, status);
}

export async function activateCategory(input: {
  category: VybeCategory;
  actorUserId: string;
  active: boolean;
  reason: string;
  checks: { key: string; completed: true; evidenceReference: string; notes: string }[];
}) {
  const required = requiredChecks[input.category].split(",");
  const supplied = input.checks.map((check) => check.key);
  const missing = required.filter((key) => !supplied.includes(key));
  const unexpected = supplied.filter((key) => !required.includes(key));
  if (input.active && (missing.length || unexpected.length || supplied.length !== required.length)) {
    fail(
      "VYBE_CATEGORY_LAUNCH_GATES_INCOMPLETE",
      `Launch checklist is incomplete. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
      400
    );
  }

  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const previous = await tx.vybeCategoryActivation.findUnique({
      where: { category: input.category }
    });
    const activation = await tx.vybeCategoryActivation.upsert({
      where: { category: input.category },
      create: {
        category: input.category,
        isActive: input.active,
        checklist: input.checks as unknown as Prisma.InputJsonValue,
        reason: input.reason,
        activatedByUserId: input.active ? input.actorUserId : null,
        activatedAt: input.active ? new Date() : null
      },
      update: {
        isActive: input.active,
        checklist: input.checks as unknown as Prisma.InputJsonValue,
        reason: input.reason,
        activatedByUserId: input.active ? input.actorUserId : null,
        activatedAt: input.active ? new Date() : null
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorUserId,
        actorType: "user",
        action: input.active ? "vybe.category.activated" : "vybe.category.deactivated",
        resourceType: "vybe_category",
        resourceId: input.category,
        metadata: {
          reason: input.reason,
          previousActive: previous?.isActive ?? false,
          checks: supplied
        }
      }
    });
    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_category",
      aggregateId: input.category,
      eventType: input.active ? "vybe.category.activated.v1" : "vybe.category.deactivated.v1",
      deduplicationKey: `vybe.category:${input.category}:activation:${randomUUID()}`,
      payload: { category: input.category, active: input.active, reason: input.reason }
    });
    return activation;
  });
}

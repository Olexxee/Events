import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import type { CreateAuditLogInput } from "./audit.types.js";

/**
 * Audit records are append-only at the application layer.
 * No update or delete operations are exposed from this repository.
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  await getPrismaClient().auditLog.create({
    data: {
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? "success",
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata ?? {}
    }
  });
}

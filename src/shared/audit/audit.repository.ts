import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import type { CreateAuditLogInput } from "./audit.types.js";

/**
 * Audit records are append-only at the application layer.
 * No update or delete operations are exposed from this repository.
 */
export async function createAuditLog(
  input: CreateAuditLogInput
): Promise<void> {
  await getPrismaClient().auditLog.create({
    data: {
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId !== undefined
        ? { resourceId: input.resourceId }
        : {}),
      outcome: input.outcome ?? "success",
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      metadata: input.metadata ?? {}
    }
  });
}

import type { Prisma } from "@prisma/client";

export interface CreateAuditLogInput {
  actorId?: string;
  actorType: "user" | "service" | "system";
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome?: "success" | "failure" | "denied";
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

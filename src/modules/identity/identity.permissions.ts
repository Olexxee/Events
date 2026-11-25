import type { PlatformRole } from "@prisma/client";

const ROLE_PERMISSIONS: Record<PlatformRole, readonly string[]> = {
  SUPPORT: ["platform:support:read"],
  PLATFORM_ADMIN: ["platform:admin:read", "platform:moderation:manage", "platform:organizers:review"],
  FINANCE_ADMIN: ["finance:read", "finance:reconcile"],
  SUPER_ADMIN: [
    "platform:support:read",
    "platform:admin:read",
    "platform:moderation:manage",
    "platform:organizers:review",
    "finance:read",
    "finance:reconcile",
    "platform:configuration:manage",
    "platform:roles:manage"
  ]
};

export function resolvePlatformPermissions(roles: PlatformRole[]): string[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))];
}

export function hasPermission(
  granted: readonly string[],
  required: string
): boolean {
  return granted.includes(required);
}

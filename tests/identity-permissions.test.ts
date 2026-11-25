import type { PlatformRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  hasPermission,
  resolvePlatformPermissions
} from "../src/modules/identity/identity.permissions.js";

describe("platform permission resolution", () => {
  it("derives permissions from persisted platform roles", () => {
    const permissions = resolvePlatformPermissions([
      "SUPPORT",
      "FINANCE_ADMIN"
    ] as PlatformRole[]);

    expect(permissions).toContain("platform:support:read");
    expect(permissions).toContain("finance:read");
    expect(permissions).not.toContain("platform:configuration:manage");
  });

  it("grants super-admin permissions explicitly without wildcard matching", () => {
    const permissions = resolvePlatformPermissions(["SUPER_ADMIN"]);

    expect(permissions).toContain("platform:roles:manage");
    expect(hasPermission(permissions, "platform:roles:manage")).toBe(true);
    expect(hasPermission(permissions, "anything:*")).toBe(false);
  });

  it("deduplicates permissions assigned through multiple platform roles", () => {
    const permissions = resolvePlatformPermissions([
      "SUPPORT",
      "SUPER_ADMIN"
    ] as PlatformRole[]);

    expect(
      permissions.filter((permission) => permission === "platform:support:read")
    ).toHaveLength(1);
  });
});

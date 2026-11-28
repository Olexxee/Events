import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  IdentityActionTokenType,
  PlatformRole,
  Prisma
} from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface NewSessionInput {
  userId: string;
  familyId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreatedSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function sessionData(input: NewSessionInput, now: Date) {
  const accessToken = newToken();
  const refreshToken = newToken();
  const data = {
    userId: input.userId,
    familyId: input.familyId ?? randomUUID(),
    accessTokenHash: digestToken(accessToken),
    refreshTokenHash: digestToken(refreshToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 512) } : {})
  };

  return {
    data,
    tokens: {
      accessToken,
      refreshToken,
      accessExpiresAt: data.accessExpiresAt,
      refreshExpiresAt: data.refreshExpiresAt
    }
  };
}

export async function createAccount(input: {
  email: string;
  passwordHash: string;
  displayName?: string;
  metadata: Omit<NewSessionInput, "userId">;
}): Promise<{
  user: {
    id: string;
    email: string;
    profile: { displayName: string | null } | null;
  };
  tokens: CreatedSession;
}> {
  const prisma = getPrismaClient();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        ...(input.displayName
          ? { profile: { create: { displayName: input.displayName } } }
          : {}),
        passwordCredential: {
          create: { passwordHash: input.passwordHash }
        }
      },
      select: {
        id: true,
        email: true,
        profile: { select: { displayName: true } }
      }
    });

    const session = sessionData({ userId: user.id, ...input.metadata }, now);
    await tx.session.create({ data: session.data });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorType: "user",
        action: "identity.account.registered",
        resourceType: "user",
        resourceId: user.id
      }
    });

    return { user, tokens: session.tokens };
  });
}

export async function findCredentialByEmail(email: string) {
  return getPrismaClient().user.findUnique({
    where: { email },
    include: {
      passwordCredential: { select: { passwordHash: true } },
      profile: { select: { displayName: true } }
    }
  });
}

export async function createSession(
  input: NewSessionInput
): Promise<CreatedSession> {
  const session = sessionData(input, new Date());
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    await tx.session.create({ data: session.data });
    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        actorType: "user",
        action: "identity.session.created",
        resourceType: "user",
        resourceId: input.userId
      }
    });
  });
  return session.tokens;
}

export async function findSessionByAccessHash(accessTokenHash: string) {
  return getPrismaClient().session.findUnique({
    where: { accessTokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          emailVerifiedAt: true,
          profile: { select: { displayName: true } },
          platformRoles: { select: { role: true } }
        }
      }
    }
  });
}

export async function touchSession(sessionId: string, at: Date): Promise<void> {
  await getPrismaClient().session.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: new Date(at.getTime() - 5 * 60 * 1000) } }
      ]
    },
    data: { lastUsedAt: at }
  });
}

export async function rotateRefreshSession(
  refreshTokenHash: string,
  metadata: Omit<NewSessionInput, "userId" | "familyId">
): Promise<
  | { status: "rotated"; userId: string; tokens: CreatedSession }
  | { status: "invalid" }
> {
  const prisma = getPrismaClient();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const previous = await tx.session.findUnique({
      where: { refreshTokenHash },
      include: { user: { select: { id: true, status: true } } }
    });

    if (!previous) return { status: "invalid" as const };

    if (previous.rotatedAt || previous.revokedAt) {
      if (previous.rotatedAt) {
        await tx.session.updateMany({
          where: { familyId: previous.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: "refresh_token_reuse" }
        });
        await tx.auditLog.create({
          data: {
            actorId: previous.userId,
            actorType: "user",
            action: "identity.session.refresh_reuse_detected",
            resourceType: "session",
            resourceId: previous.id,
            outcome: "denied"
          }
        });
      }
      return { status: "invalid" as const };
    }

    if (previous.refreshExpiresAt <= now || previous.user.status !== "ACTIVE") {
      await tx.session.updateMany({
        where: { familyId: previous.familyId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "expired_or_inactive_account" }
      });
      return { status: "invalid" as const };
    }

    const changed = await tx.session.updateMany({
      where: {
        id: previous.id,
        rotatedAt: null,
        revokedAt: null,
        refreshExpiresAt: { gt: now }
      },
      data: { rotatedAt: now, revokedAt: now, revokeReason: "rotated" }
    });

    if (changed.count !== 1) {
      await tx.session.updateMany({
        where: { familyId: previous.familyId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "refresh_token_reuse" }
      });
      return { status: "invalid" as const };
    }

    const next = sessionData(
      {
        userId: previous.userId,
        familyId: previous.familyId,
        ...metadata
      },
      now
    );
    await tx.session.create({ data: next.data });
    await tx.auditLog.create({
      data: {
        actorId: previous.userId,
        actorType: "user",
        action: "identity.session.rotated",
        resourceType: "session",
        resourceId: previous.id
      }
    });

    return {
      status: "rotated" as const,
      userId: previous.userId,
      tokens: next.tokens
    };
  });
}

export async function revokeSessionFamily(
  sessionId: string,
  userId: string,
  reason: string
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const session = await tx.session.findFirst({
      where: { id: sessionId, userId },
      select: { familyId: true }
    });
    if (!session) return;

    await tx.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason }
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "identity.session.revoked",
        resourceType: "session",
        resourceId: sessionId,
        metadata: { reason }
      }
    });
  });
}

export async function createOrganizationForUser(userId: string, name: string) {
  const prisma = getPrismaClient();
  const slugBase =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 150) || "organization";
  const slug = `${slugBase}-${randomUUID().slice(0, 8)}`;

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name,
        slug,
        createdById: userId,
        memberships: {
          create: { userId, role: "OWNER", status: "ACTIVE" }
        }
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "organization.created",
        resourceType: "organization",
        resourceId: organization.id
      }
    });
    return organization;
  });
}

export async function listOrganizationsForUser(userId: string) {
  return getPrismaClient().organization.findMany({
    where: {
      status: "ACTIVE",
      memberships: { some: { userId, status: "ACTIVE" } }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { role: true }
      }
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function userHasOrganizationPermission(
  userId: string,
  organizationId: string,
  permission: string
): Promise<boolean> {
  const membership = await getPrismaClient().organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      status: true,
      organization: { select: { status: true } },
      role: true
    }
  });

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.organization.status !== "ACTIVE"
  ) {
    return false;
  }

  if (permission === "organization:read") return true;
  if (
    permission === "organization:manage" ||
    permission === "organization:members:manage"
  ) {
    return membership.role === "OWNER" || membership.role === "ADMIN";
  }

  return false;
}

export type StoredPlatformRole = PlatformRole;
export type TransactionClient = Prisma.TransactionClient;

export async function findUserById(userId: string) {
  return getPrismaClient().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      createdAt: true,
      profile: { select: { displayName: true, phone: true } }
    }
  });
}

export async function findActiveUserForIdentityEmail(email: string) {
  return getPrismaClient().user.findUnique({
    where: { email },
    select: { id: true, email: true, status: true, emailVerifiedAt: true }
  });
}

export async function reserveIdentityEmailRequest(
  email: string,
  ipAddress: string,
  limit: number
): Promise<boolean> {
  const prisma = getPrismaClient();
  const emailHash = digestToken(email.trim().toLowerCase());
  const ip = ipAddress.slice(0, 64) || "unknown";
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const lockKey = `${emailHash}:${ip}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const count = await tx.identityActionRequest.count({
      where: { emailHash, ipAddress: ip, createdAt: { gte: since } }
    });
    if (count >= limit) return false;
    await tx.identityActionRequest.create({
      data: { emailHash, ipAddress: ip }
    });
    return true;
  });
}

export async function issueIdentityActionToken(
  userId: string,
  type: IdentityActionTokenType,
  ttlMinutes: number
): Promise<string> {
  const token = newToken();
  const prisma = getPrismaClient();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.identityActionToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: now }
    });
    await tx.identityActionToken.create({
      data: {
        userId,
        type,
        tokenHash: digestToken(token),
        expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000)
      }
    });
  });
  return token;
}

export async function consumeIdentityActionToken(
  token: string,
  type: IdentityActionTokenType,
  passwordHash?: string
): Promise<boolean> {
  const prisma = getPrismaClient();
  const now = new Date();
  const tokenHash = digestToken(token);

  return prisma.$transaction(async (tx) => {
    const stored = await tx.identityActionToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        type: true,
        consumedAt: true,
        expiresAt: true
      }
    });
    if (
      !stored ||
      stored.type !== type ||
      stored.consumedAt ||
      stored.expiresAt <= now
    ) {
      return false;
    }

    const consumed = await tx.identityActionToken.updateMany({
      where: { id: stored.id, type, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    if (consumed.count !== 1) {
      return false;
    }

    if (type === "EMAIL_VERIFICATION") {
      await tx.user.updateMany({
        where: { id: stored.userId, status: "ACTIVE", emailVerifiedAt: null },
        data: { emailVerifiedAt: now }
      });
      await tx.auditLog.create({
        data: {
          actorId: stored.userId,
          actorType: "user",
          action: "identity.email.verified",
          resourceType: "user",
          resourceId: stored.userId
        }
      });
      return true;
    }

    if (!passwordHash) return false;
    await tx.passwordCredential.update({
      where: { userId: stored.userId },
      data: { passwordHash, passwordChangedAt: now }
    });
    await tx.session.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: "password_reset" }
    });
    await tx.auditLog.create({
      data: {
        actorId: stored.userId,
        actorType: "user",
        action: "identity.password.reset",
        resourceType: "user",
        resourceId: stored.userId
      }
    });
    return true;
  });
}

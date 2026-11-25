import { AppError } from "../../shared/errors/app-error.js";
import {
  createAccount,
  createOrganizationForUser,
  createSession,
  digestToken,
  findCredentialByEmail,
  findUserById,
  findSessionByAccessHash,
  listOrganizationsForUser,
  revokeSessionFamily,
  rotateRefreshSession,
  touchSession,
  userHasOrganizationPermission
} from "./identity.db.js";
import { resolvePlatformPermissions } from "./identity.permissions.js";
import { hashPassword, verifyPassword } from "./password.service.js";

const DUMMY_PASSWORD_HASH = hashPassword("events-dummy-password-never-used");
import type { SessionMetadata } from "./identity.types.js";

function invalidCredentials(): AppError {
  return new AppError(
    "INVALID_CREDENTIALS",
    "Email or password is incorrect",
    401
  );
}

function sessionResponse(tokens: {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}) {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: "Bearer" as const,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString()
  };
}

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
  metadata: SessionMetadata;
}) {
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await createAccount({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      metadata: input.metadata
    });

    return {
      user: result.user,
      session: sessionResponse(result.tokens)
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "ACCOUNT_ALREADY_EXISTS",
        "An account with this email already exists",
        409
      );
    }
    throw error;
  }
}

export async function login(
  input: { email: string; password: string },
  metadata: SessionMetadata
) {
  const user = await findCredentialByEmail(input.email.trim().toLowerCase());

  const passwordHash =
    user?.passwordCredential?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
  const passwordMatches = await verifyPassword(input.password, passwordHash);

  if (
    !user ||
    !user.passwordCredential ||
    user.status !== "ACTIVE" ||
    !passwordMatches
  ) {
    throw invalidCredentials();
  }

  const tokens = await createSession({ userId: user.id, ...metadata });
  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      profile: user.profile
    },
    session: sessionResponse(tokens)
  };
}

export async function refresh(refreshToken: string, metadata: SessionMetadata) {
  const result = await rotateRefreshSession(
    digestToken(refreshToken),
    metadata
  );
  if (result.status !== "rotated") {
    throw new AppError(
      "INVALID_SESSION",
      "The session is no longer valid",
      401
    );
  }
  return { session: sessionResponse(result.tokens) };
}

export async function authenticateAccessToken(accessToken: string) {
  const session = await findSessionByAccessHash(digestToken(accessToken));
  const now = new Date();

  if (
    !session ||
    session.revokedAt ||
    session.accessExpiresAt <= now ||
    session.user.status !== "ACTIVE"
  ) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }

  await touchSession(session.id, now);

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      status: session.user.status,
      emailVerifiedAt: session.user.emailVerifiedAt,
      profile: session.user.profile
    },
    auth: {
      subjectId: session.user.id,
      subjectType: "user" as const,
      sessionId: session.id,
      permissions: resolvePlatformPermissions(
        session.user.platformRoles.map((assignment) => assignment.role)
      )
    }
  };
}

export async function logout(sessionId: string, userId: string) {
  await revokeSessionFamily(sessionId, userId, "user_logout");
}

export async function listMyOrganizations(userId: string) {
  return listOrganizationsForUser(userId);
}

export async function createMyOrganization(userId: string, name: string) {
  return createOrganizationForUser(userId, name);
}

export async function canAccessOrganization(
  userId: string,
  organizationId: string,
  permission: string
) {
  return userHasOrganizationPermission(userId, organizationId, permission);
}

export async function getCurrentUser(userId: string) {
  const user = await findUserById(userId);
  if (!user || user.status !== "ACTIVE") {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return user;
}

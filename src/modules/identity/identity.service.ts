import { AppError } from "../../shared/errors/app-error.js";
import {
  createAccount,
  createOrganizationForUser,
  createSession,
  digestToken,
  findCredentialByEmail,
  findUserById,
  findActiveUserForIdentityEmail,
  reserveIdentityEmailRequest,
  issueIdentityActionToken,
  consumeIdentityActionToken,
  findSessionByAccessHash,
  listOrganizationsForUser,
  revokeSessionFamily,
  rotateRefreshSession,
  touchSession,
  userHasOrganizationPermission
} from "./identity.db.js";
import { resolvePlatformPermissions } from "./identity.permissions.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import { sendIdentityEmail } from "./identity.email.js";

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

    const verificationToken = await issueIdentityActionToken(
      result.user.id,
      "EMAIL_VERIFICATION",
      Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES ?? 30)
    );
    try {
      await sendIdentityEmail(result.user.email, "verification", verificationToken);
    } catch (error) {
      console.error("Identity verification email delivery failed", error);
    }

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


const GENERIC_IDENTITY_EMAIL_RESPONSE = {
  accepted: true,
  message: "If the account is eligible, an email will be sent shortly."
};

export async function requestEmailVerification(email: string, ipAddress: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const allowed = await reserveIdentityEmailRequest(
    normalizedEmail,
    ipAddress,
    Number(process.env.IDENTITY_EMAIL_RATE_LIMIT_PER_HOUR ?? 3)
  );
  if (!allowed) return GENERIC_IDENTITY_EMAIL_RESPONSE;

  const user = await findActiveUserForIdentityEmail(normalizedEmail);
  if (!user || user.status !== "ACTIVE" || user.emailVerifiedAt) {
    return GENERIC_IDENTITY_EMAIL_RESPONSE;
  }

  const token = await issueIdentityActionToken(
    user.id,
    "EMAIL_VERIFICATION",
    Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES ?? 30)
  );
  try {
    await sendIdentityEmail(user.email, "verification", token);
  } catch (error) {
    console.error("Identity verification email delivery failed", error);
  }
  return GENERIC_IDENTITY_EMAIL_RESPONSE;
}

export async function verifyEmailAddress(token: string) {
  const verified = await consumeIdentityActionToken(token, "EMAIL_VERIFICATION");
  if (!verified) {
    throw new AppError("INVALID_OR_EXPIRED_TOKEN", "This verification link is invalid or has expired", 400);
  }
  return { verified: true };
}

export async function requestPasswordReset(email: string, ipAddress: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const allowed = await reserveIdentityEmailRequest(
    normalizedEmail,
    ipAddress,
    Number(process.env.IDENTITY_EMAIL_RATE_LIMIT_PER_HOUR ?? 3)
  );
  if (!allowed) return GENERIC_IDENTITY_EMAIL_RESPONSE;

  const user = await findActiveUserForIdentityEmail(normalizedEmail);
  if (!user || user.status !== "ACTIVE") return GENERIC_IDENTITY_EMAIL_RESPONSE;

  const token = await issueIdentityActionToken(
    user.id,
    "PASSWORD_RESET",
    Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 30)
  );
  try {
    await sendIdentityEmail(user.email, "password-reset", token);
  } catch (error) {
    console.error("Password reset email delivery failed", error);
  }
  return GENERIC_IDENTITY_EMAIL_RESPONSE;
}

export async function resetPassword(token: string, password: string) {
  const passwordHash = await hashPassword(password);
  const reset = await consumeIdentityActionToken(token, "PASSWORD_RESET", passwordHash);
  if (!reset) {
    throw new AppError("INVALID_OR_EXPIRED_TOKEN", "This password reset link is invalid or has expired", 400);
  }
  return { passwordReset: true };
}

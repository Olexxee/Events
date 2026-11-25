export interface AuthContext {
  subjectId: string;
  subjectType: "user";
  sessionId: string;
  permissions: string[];
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  emailVerifiedAt: Date | null;
  profile: { displayName: string | null } | null;
}

import type { RequestHandler } from "express";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  createMyOrganization,
  getCurrentUser,
  listMyOrganizations,
  login,
  logout,
  refresh,
  register
} from "./identity.service.js";

const REFRESH_COOKIE = "events_refresh";
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function refreshCookieOptions(req: Parameters<RequestHandler>[0]) {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    path: `${req.baseUrl}/auth`,
    maxAge: REFRESH_COOKIE_TTL_MS
  };
}
function setRefreshCookie(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(req));
}
function clearRefreshCookie(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const { maxAge, ...options } = refreshCookieOptions(req);
  void maxAge;
  res.clearCookie(REFRESH_COOKIE, options);
}
function cookieValue(req: Parameters<RequestHandler>[0], name: string): string | undefined {
  const header = req.get("cookie");
  if (!header) return undefined;
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}
function withoutRefreshToken<T extends { session: { refreshToken: string } }>(result: T) {
  const { refreshToken, ...session } = result.session;
  void refreshToken;
  return { ...result, session };
}

function requestMetadata(req: Parameters<RequestHandler>[0]) {
  const userAgent = req.get("user-agent");
  return {
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(userAgent ? { userAgent } : {})
  };
}

export const registerController: RequestHandler = async (req, res, next) => {
  try {
    const input = getValidatedRequest<{
      body: { email: string; password: string; displayName?: string };
    }>(res).body;
    const result = await register({ ...input, metadata: requestMetadata(req) });
    if (req.get("origin")) {
      setRefreshCookie(req, res, result.session.refreshToken);
      return successResponse(res, withoutRefreshToken(result), 201);
    }
    return successResponse(res, result, 201);
  } catch (error) {
    return next(error);
  }
};

export const loginController: RequestHandler = async (req, res, next) => {
  try {
    const input = getValidatedRequest<{
      body: { email: string; password: string };
    }>(res).body;
    const result = await login(input, requestMetadata(req));
    if (req.get("origin")) {
      setRefreshCookie(req, res, result.session.refreshToken);
      return successResponse(res, withoutRefreshToken(result));
    }
    return successResponse(res, result);
  } catch (error) {
    return next(error);
  }
};

export const refreshController: RequestHandler = async (req, res, next) => {
  try {
    const input = getValidatedRequest<{
      body: { refreshToken?: string };
    }>(res).body;
    const cookieToken = cookieValue(req, REFRESH_COOKIE);
    const token = cookieToken ?? input.refreshToken;
    if (!token) {
      return res.status(401).json({ success: false, error: { code: "INVALID_SESSION", message: "The session is no longer valid", details: [] } });
    }
    const result = await refresh(token, requestMetadata(req));
    if (cookieToken) {
      setRefreshCookie(req, res, result.session.refreshToken);
      return successResponse(res, withoutRefreshToken(result));
    }
    return successResponse(res, result);
  } catch (error) {
    return next(error);
  }
};

export const logoutController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          details: []
        }
      });
    }
    const { sessionId, subjectId } = req.auth;
    if (!sessionId || !subjectId) {
      return next(new Error("Authenticated session context is incomplete"));
    }
    await logout(sessionId, subjectId);
    clearRefreshCookie(req, res);
    return successResponse(res, { loggedOut: true });
  } catch (error) {
    return next(error);
  }
};

export const currentUserController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          details: []
        }
      });
    }
    const user = await getCurrentUser(req.auth.subjectId);
    return successResponse(res, { user });
  } catch (error) {
    return next(error);
  }
};

export const createOrganizationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          details: []
        }
      });
    }
    const input = getValidatedRequest<{ body: { name: string } }>(res).body;
    const organization = await createMyOrganization(
      req.auth.subjectId,
      input.name
    );
    return successResponse(res, { organization }, 201);
  } catch (error) {
    return next(error);
  }
};

export const listOrganizationsController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          details: []
        }
      });
    }
    const organizations = await listMyOrganizations(req.auth.subjectId);
    return successResponse(res, { organizations });
  } catch (error) {
    return next(error);
  }
};

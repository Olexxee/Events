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
    return successResponse(res, result);
  } catch (error) {
    return next(error);
  }
};

export const refreshController: RequestHandler = async (req, res, next) => {
  try {
    const input = getValidatedRequest<{
      body: { refreshToken: string };
    }>(res).body;
    const result = await refresh(input.refreshToken, requestMetadata(req));
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
    await logout(req.auth.sessionId, req.auth.subjectId);
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

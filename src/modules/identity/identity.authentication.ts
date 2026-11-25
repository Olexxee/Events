import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import {
  authenticateAccessToken,
  canAccessOrganization
} from "./identity.service.js";

export const authenticateRequest: RequestHandler = async (req, _res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,512})$/);

  const accessToken = match?.[1];

  if (!accessToken) {
    return next(
      new AppError("UNAUTHENTICATED", "Authentication is required", 401)
    );
  }

  try {
    const result = await authenticateAccessToken(accessToken);
    req.auth = result.auth;
    return next();
  } catch (error) {
    return next(error);
  }
};

export function requireOrganizationPermission(
  permission: string
): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) {
      return next(
        new AppError("UNAUTHENTICATED", "Authentication is required", 401)
      );
    }

    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || !organizationId) {
      return next(
        new AppError(
          "ORGANIZATION_CONTEXT_REQUIRED",
          "An organization context is required",
          400
        )
      );
    }

    try {
      const allowed = await canAccessOrganization(
        req.auth.subjectId,
        organizationId,
        permission
      );
      if (!allowed) {
        return next(
          new AppError(
            "FORBIDDEN",
            "You do not have permission to perform this action",
            403
          )
        );
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

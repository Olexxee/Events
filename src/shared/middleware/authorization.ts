import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export function requirePermission(permission: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      return next(
        new AppError("UNAUTHENTICATED", "Authentication is required", 401)
      );
    }

    if (!req.auth.permissions.includes(permission)) {
      return next(
        new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action",
          403
        )
      );
    }

    return next();
  };
}

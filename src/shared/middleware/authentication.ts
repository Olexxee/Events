import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const requireAuthenticated: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    return next(
      new AppError("UNAUTHENTICATED", "Authentication is required", 401)
    );
  }

  return next();
};

import { Router } from "express";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import { authenticateRequest } from "./identity.authentication.js";
import {
  createOrganizationController,
  currentUserController,
  listOrganizationsController,
  loginController,
  logoutController,
  refreshController,
  registerController
} from "./identity.controller.js";
import {
  loginSchema,
  organizationSchema,
  refreshSchema,
  registerSchema
} from "./identity.validators.js";

export const identityRouter = Router();

identityRouter.post("/auth/register", validateRequest(registerSchema), registerController);
identityRouter.post("/auth/login", validateRequest(loginSchema), loginController);
identityRouter.post("/auth/refresh", validateRequest(refreshSchema), refreshController);
identityRouter.post("/auth/logout", authenticateRequest, requireAuthenticated, logoutController);
identityRouter.get("/auth/me", authenticateRequest, requireAuthenticated, currentUserController);

identityRouter.post(
  "/organizations",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(organizationSchema),
  createOrganizationController
);
identityRouter.get(
  "/organizations",
  authenticateRequest,
  requireAuthenticated,
  listOrganizationsController
);

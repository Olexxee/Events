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
  registerController,
  requestEmailVerificationController,
  verifyEmailController,
  requestPasswordResetController,
  resetPasswordController
} from "./identity.controller.js";
import {
  loginSchema,
  organizationSchema,
  refreshSchema,
  registerSchema,
  identityEmailRequestSchema,
  identityTokenSchema,
  passwordResetSchema
} from "./identity.validators.js";

export const identityRouter = Router();

identityRouter.post(
  "/auth/register",
  validateRequest(registerSchema),
  registerController
);
identityRouter.post("/auth/verify-email/request", validateRequest(identityEmailRequestSchema), requestEmailVerificationController);
identityRouter.post("/auth/verify-email", validateRequest(identityTokenSchema), verifyEmailController);
identityRouter.post("/auth/password/forgot", validateRequest(identityEmailRequestSchema), requestPasswordResetController);
identityRouter.post("/auth/password/reset", validateRequest(passwordResetSchema), resetPasswordController);
identityRouter.post(
  "/auth/login",
  validateRequest(loginSchema),
  loginController
);
identityRouter.post(
  "/auth/refresh",
  validateRequest(refreshSchema),
  refreshController
);
identityRouter.post(
  "/auth/logout",
  authenticateRequest,
  requireAuthenticated,
  logoutController
);
identityRouter.get(
  "/auth/me",
  authenticateRequest,
  requireAuthenticated,
  currentUserController
);

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

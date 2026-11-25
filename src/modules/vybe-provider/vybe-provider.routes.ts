import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { requirePermission } from "../../shared/middleware/authorization.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  addVybeProviderEvidenceController,
  changeVybeProviderApprovalStatusController,
  myVybeProviderApplicationsController,
  reviewVybeProviderApplicationController,
  submitVybeProviderApplicationController,
  vybeProviderApplicationQueueController
} from "./vybe-provider.controller.js";
import {
  addVybeProviderEvidenceSchema,
  changeVybeProviderApprovalStatusSchema,
  reviewVybeProviderApplicationSchema,
  submitVybeProviderApplicationSchema
} from "./vybe-provider.validators.js";

export const vybeProviderRouter = Router();

vybeProviderRouter.post(
  "/vybe/provider-applications",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(submitVybeProviderApplicationSchema),
  submitVybeProviderApplicationController
);

vybeProviderRouter.get(
  "/vybe/provider-applications/mine",
  authenticateRequest,
  requireAuthenticated,
  myVybeProviderApplicationsController
);

vybeProviderRouter.get(
  "/vybe/provider-applications",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:vybe:providers:review"),
  vybeProviderApplicationQueueController
);

vybeProviderRouter.patch(
  "/vybe/provider-applications/:id/review",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:vybe:providers:review"),
  validateRequest(reviewVybeProviderApplicationSchema),
  reviewVybeProviderApplicationController
);

vybeProviderRouter.post(
  "/vybe/provider-applications/:id/evidence",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(addVybeProviderEvidenceSchema),
  addVybeProviderEvidenceController
);

vybeProviderRouter.patch(
  "/vybe/provider-approvals/:id/status",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:vybe:providers:review"),
  validateRequest(changeVybeProviderApprovalStatusSchema),
  changeVybeProviderApprovalStatusController
);

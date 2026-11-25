import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { requirePermission } from "../../shared/middleware/authorization.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  decideOrganizerApplicationController,
  myOrganizerApplicationsController,
  organizerApplicationsQueueController,
  submitOrganizerApplicationController
} from "./organizers.controller.js";
import {
  decideOrganizerApplicationSchema,
  submitOrganizerApplicationSchema
} from "./organizers.validators.js";

export const organizersRouter = Router();

organizersRouter.post(
  "/organizer-applications",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(submitOrganizerApplicationSchema),
  submitOrganizerApplicationController
);
organizersRouter.get(
  "/organizer-applications/mine",
  authenticateRequest,
  requireAuthenticated,
  myOrganizerApplicationsController
);
organizersRouter.get(
  "/organizer-applications",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:organizers:review"),
  organizerApplicationsQueueController
);
organizersRouter.patch(
  "/organizer-applications/:id/decision",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:organizers:review"),
  validateRequest(decideOrganizerApplicationSchema),
  decideOrganizerApplicationController
);

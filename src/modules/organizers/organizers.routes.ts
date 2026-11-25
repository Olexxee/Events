import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from
  "../../shared/middleware/authentication.js";
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

organizersRouter.use(authenticateRequest, requireAuthenticated);
organizersRouter.post(
  "/organizer-applications",
  validateRequest(submitOrganizerApplicationSchema),
  submitOrganizerApplicationController
);
organizersRouter.get(
  "/organizer-applications/mine",
  myOrganizerApplicationsController
);
organizersRouter.get(
  "/organizer-applications",
  requirePermission("platform:organizers:review"),
  organizerApplicationsQueueController
);
organizersRouter.patch(
  "/organizer-applications/:id/decision",
  requirePermission("platform:organizers:review"),
  validateRequest(decideOrganizerApplicationSchema),
  decideOrganizerApplicationController
);

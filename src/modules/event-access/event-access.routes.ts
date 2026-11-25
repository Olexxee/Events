import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  submitRequestController, myAccessController, withdrawRequestController,
  listRequestsController, decideRequestController, issueInvitationController,
  invitationAcceptController, invitationDeclineController, revokeGrantController,
  placeHoldController, releaseHoldController, revokeInvitationController, platformRevokeGrantController
} from "./event-access.controller.js";
import {
  eventIdParams, organizationEventParams, requestCreate, requestIdParams, decisionSchema, invitationSchema,
  invitationTokenSchema, revokeGrantSchema, holdSchema, invitationRevokeSchema, platformGrantRevokeSchema
} from "./event-access.validators.js";

export const eventAccessRouter = Router();
const requirePlatformIntervention = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(new AppError("UNAUTHENTICATED", "Authentication is required", 401));
  if (!req.auth.permissions.includes("platform:events:access:intervene"))
    return next(new AppError("FORBIDDEN", "Platform event-access intervention permission is required", 403));
  return next();
};

eventAccessRouter.post("/events/:eventId/access-requests", authenticateRequest, requireAuthenticated, validateRequest(requestCreate), submitRequestController);
eventAccessRouter.get("/me/events/:eventId/access", authenticateRequest, requireAuthenticated, validateRequest(eventIdParams), myAccessController);
eventAccessRouter.delete("/events/access-requests/:requestId", authenticateRequest, requireAuthenticated, validateRequest(requestIdParams), withdrawRequestController);
eventAccessRouter.get("/organizations/:organizationId/events/:eventId/access-requests", authenticateRequest, requireAuthenticated, validateRequest(organizationEventParams), listRequestsController);
eventAccessRouter.post("/organizations/:organizationId/events/:eventId/access-requests/:requestId/decision", authenticateRequest, requireAuthenticated, validateRequest(decisionSchema), decideRequestController);
eventAccessRouter.post("/organizations/:organizationId/events/:eventId/invitations", authenticateRequest, requireAuthenticated, validateRequest(invitationSchema), issueInvitationController);
eventAccessRouter.post("/event-invitations/:token/accept", authenticateRequest, requireAuthenticated, validateRequest(invitationTokenSchema), invitationAcceptController);
eventAccessRouter.post("/event-invitations/:token/decline", authenticateRequest, requireAuthenticated, validateRequest(invitationTokenSchema), invitationDeclineController);
eventAccessRouter.post("/organizations/:organizationId/events/:eventId/access-grants/:grantId/revoke", authenticateRequest, requireAuthenticated, validateRequest(revokeGrantSchema), revokeGrantController);
eventAccessRouter.post("/organizations/:organizationId/events/:eventId/invitations/:invitationId/revoke", authenticateRequest, requireAuthenticated, validateRequest(invitationRevokeSchema), revokeInvitationController);
eventAccessRouter.post("/platform/events/:eventId/access-hold", authenticateRequest, requireAuthenticated, requirePlatformIntervention, validateRequest(holdSchema), placeHoldController);
eventAccessRouter.delete("/platform/events/:eventId/access-hold", authenticateRequest, requireAuthenticated, requirePlatformIntervention, validateRequest(holdSchema), releaseHoldController);
eventAccessRouter.post("/platform/events/:eventId/access-grants/:grantId/revoke", authenticateRequest, requireAuthenticated, requirePlatformIntervention, validateRequest(platformGrantRevokeSchema), platformRevokeGrantController);

import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  createHoldController,
  createTicketTypeController,
  listManagedTicketTypesController,
  listTicketTypesController,
  releaseHoldController
} from "./ticketing.controller.js";
import {
  createTicketTypeSchema,
  eventIdSchema,
  holdIdSchema,
  holdSchema
} from "./ticketing.validators.js";

export const ticketingRouter = Router();
ticketingRouter.get("/events/:eventId/ticket-types", authenticateRequest, requireAuthenticated, validateRequest(eventIdSchema), listTicketTypesController);
ticketingRouter.post("/managed/events/:eventId/ticket-types", authenticateRequest, requireAuthenticated, validateRequest(createTicketTypeSchema), createTicketTypeController);
ticketingRouter.get("/managed/events/:eventId/ticket-types", authenticateRequest, requireAuthenticated, validateRequest(eventIdSchema), listManagedTicketTypesController);
ticketingRouter.post("/events/:eventId/ticket-holds", authenticateRequest, requireAuthenticated, validateRequest(holdSchema), createHoldController);
ticketingRouter.post("/ticket-holds/:id/release", authenticateRequest, requireAuthenticated, validateRequest(holdIdSchema), releaseHoldController);

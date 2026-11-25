import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  categoriesController, createEventController, discoverEventsController, managedEventController,
  managedEventsController, publicEventController, publishEventController, updateEventController
} from "./events.controller.js";
import { createEventSchema, eventIdSchema, publicEventsQuerySchema, updateEventSchema } from "./events.validators.js";

export const eventsRouter = Router();
eventsRouter.get("/event-categories", categoriesController);
eventsRouter.get("/events", validateRequest(publicEventsQuerySchema), discoverEventsController);
eventsRouter.get("/events/:id", validateRequest(eventIdSchema), publicEventController);
eventsRouter.post("/events", authenticateRequest, requireAuthenticated, validateRequest(createEventSchema), createEventController);
eventsRouter.get("/organizations/:organizationId/events", authenticateRequest, requireAuthenticated, managedEventsController);
eventsRouter.get("/managed/events/:id", authenticateRequest, requireAuthenticated, validateRequest(eventIdSchema), managedEventController);
eventsRouter.put("/managed/events/:id", authenticateRequest, requireAuthenticated, validateRequest(updateEventSchema), updateEventController);
eventsRouter.post("/managed/events/:id/publish", authenticateRequest, requireAuthenticated, validateRequest(eventIdSchema), publishEventController);

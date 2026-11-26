import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  addVybeTimeSlotResourceGroupMemberController,
  createVybeTimeSlotOccurrenceController,
  createVybeTimeSlotResourceController,
  createVybeTimeSlotResourceGroupController
} from "./vybe-time-slots.controller.js";
import {
  addVybeTimeSlotResourceGroupMemberSchema,
  createVybeTimeSlotOccurrenceSchema,
  createVybeTimeSlotResourceGroupSchema,
  createVybeTimeSlotResourceSchema
} from "./vybe-time-slots.validators.js";

export const vybeTimeSlotsRouter = Router();

vybeTimeSlotsRouter.post(
  "/vybe/time-slots/occurrences",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeTimeSlotOccurrenceSchema),
  createVybeTimeSlotOccurrenceController
);
vybeTimeSlotsRouter.post(
  "/vybe/time-slots/resource-groups",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeTimeSlotResourceGroupSchema),
  createVybeTimeSlotResourceGroupController
);
vybeTimeSlotsRouter.post(
  "/vybe/time-slots/resources",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeTimeSlotResourceSchema),
  createVybeTimeSlotResourceController
);
vybeTimeSlotsRouter.post(
  "/vybe/time-slots/resource-groups/:groupId/members",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(addVybeTimeSlotResourceGroupMemberSchema),
  addVybeTimeSlotResourceGroupMemberController
);

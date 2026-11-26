import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  addVybeTimeSlotResourceGroupMemberController,
  createVybeTimeSlotCapacityHoldController,
  createVybeTimeSlotOccurrenceController,
  createVybeTimeSlotResourceController,
  createVybeTimeSlotResourceGroupController,
  getVybeTimeSlotAvailabilityController,
  releaseVybeTimeSlotCapacityHoldController
} from "./vybe-time-slots.controller.js";
import {
  addVybeTimeSlotResourceGroupMemberSchema,
  createVybeTimeSlotCapacityHoldSchema,
  createVybeTimeSlotOccurrenceSchema,
  createVybeTimeSlotResourceGroupSchema,
  createVybeTimeSlotResourceSchema,
  getVybeTimeSlotAvailabilitySchema,
  releaseVybeTimeSlotCapacityHoldSchema
} from "./vybe-time-slots.validators.js";

export const vybeTimeSlotsRouter = Router();

vybeTimeSlotsRouter.get(
  "/vybe/time-slots/:occurrenceId/availability",
  validateRequest(getVybeTimeSlotAvailabilitySchema),
  getVybeTimeSlotAvailabilityController
);
vybeTimeSlotsRouter.post(
  "/vybe/time-slots/holds",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeTimeSlotCapacityHoldSchema),
  createVybeTimeSlotCapacityHoldController
);
vybeTimeSlotsRouter.delete(
  "/vybe/time-slots/holds/:holdId",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(releaseVybeTimeSlotCapacityHoldSchema),
  releaseVybeTimeSlotCapacityHoldController
);
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

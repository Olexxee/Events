import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  adjustVybeAccommodationAllocationNightController,
  createVybeAccommodationAllocationController,
  createVybeAccommodationHoldController,
  getMyVybeAccommodationHoldController,
  getVybeAccommodationAvailabilityController,
  releaseMyVybeAccommodationHoldController,
  createVybeAccommodationPropertyController,
  createVybeAccommodationRoomCategoryController,
  listMyVybeAccommodationPropertiesController,
  releaseVybeAccommodationAllocationController,
  updateVybeAccommodationCapacityController
} from "./vybe-accommodation.controller.js";
import {
  adjustAccommodationAllocationNightSchema,
  createAccommodationAllocationSchema,
  createAccommodationHoldSchema,
  accommodationHoldIdSchema,
  getAccommodationAvailabilitySchema,
  createAccommodationPropertySchema,
  createAccommodationRoomCategorySchema,
  releaseAccommodationAllocationSchema,
  updateAccommodationCapacitySchema
} from "./vybe-accommodation.validators.js";

export const vybeAccommodationRouter = Router();

vybeAccommodationRouter.post(
  "/vybe/accommodation/properties",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createAccommodationPropertySchema),
  createVybeAccommodationPropertyController
);

vybeAccommodationRouter.get(
  "/vybe/accommodation/properties/mine",
  authenticateRequest,
  requireAuthenticated,
  listMyVybeAccommodationPropertiesController
);

vybeAccommodationRouter.post(
  "/vybe/accommodation/properties/:propertyId/room-categories",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createAccommodationRoomCategorySchema),
  createVybeAccommodationRoomCategoryController
);

vybeAccommodationRouter.patch(
  "/vybe/accommodation/room-categories/:roomCategoryId/capacity",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(updateAccommodationCapacitySchema),
  updateVybeAccommodationCapacityController
);

vybeAccommodationRouter.post(
  "/vybe/accommodation/room-categories/:roomCategoryId/allocations",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createAccommodationAllocationSchema),
  createVybeAccommodationAllocationController
);

vybeAccommodationRouter.patch(
  "/vybe/accommodation/allocation-nights/:allocationNightId/adjustments",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(adjustAccommodationAllocationNightSchema),
  adjustVybeAccommodationAllocationNightController
);

vybeAccommodationRouter.post(
  "/vybe/accommodation/allocations/:allocationId/release",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(releaseAccommodationAllocationSchema),
  releaseVybeAccommodationAllocationController
);

vybeAccommodationRouter.get(
  "/vybe/accommodation/room-categories/:roomCategoryId/availability",
  validateRequest(getAccommodationAvailabilitySchema),
  getVybeAccommodationAvailabilityController
);

vybeAccommodationRouter.post(
  "/vybe/accommodation/holds",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createAccommodationHoldSchema),
  createVybeAccommodationHoldController
);

vybeAccommodationRouter.get(
  "/vybe/accommodation/holds/:holdId",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(accommodationHoldIdSchema),
  getMyVybeAccommodationHoldController
);

vybeAccommodationRouter.delete(
  "/vybe/accommodation/holds/:holdId",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(accommodationHoldIdSchema),
  releaseMyVybeAccommodationHoldController
);

import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  adjustVybeInventoryAllocationController,
  createVybeInventoryHoldController,
  createVybeInventoryPoolController,
  getVybeInventoryAvailabilityController,
  releaseVybeInventoryHoldController
} from "./vybe-inventory.controller.js";
import {
  adjustVybeInventoryAllocationSchema,
  createVybeInventoryHoldSchema,
  createVybeInventoryPoolSchema,
  getVybeInventoryAvailabilitySchema,
  releaseVybeInventoryHoldSchema
} from "./vybe-inventory.validators.js";

export const vybeInventoryRouter = Router();

vybeInventoryRouter.get(
  "/vybe/offerings/:offeringId/availability",
  validateRequest(getVybeInventoryAvailabilitySchema),
  getVybeInventoryAvailabilityController
);
vybeInventoryRouter.post(
  "/vybe/inventory/pools",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeInventoryPoolSchema),
  createVybeInventoryPoolController
);
vybeInventoryRouter.patch(
  "/vybe/inventory/pools/:poolId/allocation",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(adjustVybeInventoryAllocationSchema),
  adjustVybeInventoryAllocationController
);
vybeInventoryRouter.post(
  "/vybe/inventory/holds",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(createVybeInventoryHoldSchema),
  createVybeInventoryHoldController
);
vybeInventoryRouter.delete(
  "/vybe/inventory/holds/:holdId",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(releaseVybeInventoryHoldSchema),
  releaseVybeInventoryHoldController
);

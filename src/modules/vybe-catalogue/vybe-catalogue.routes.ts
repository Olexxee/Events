import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { requirePermission } from "../../shared/middleware/authorization.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  activateVybeCategoryController,
  createVybeOfferingController,
  listVybeCatalogueController,
  publishVybeOfferingController,
  updateVybeOfferingDraftController
} from "./vybe-catalogue.controller.js";
import {
  activateVybeCategorySchema,
  createVybeOfferingSchema,
  listVybeCatalogueSchema,
  publishVybeOfferingSchema,
  updateVybeOfferingDraftSchema
} from "./vybe-catalogue.validators.js";

export const vybeCatalogueRouter = Router();

vybeCatalogueRouter.get("/vybe/catalogue", validateRequest(listVybeCatalogueSchema), listVybeCatalogueController);
vybeCatalogueRouter.post("/vybe/offerings", authenticateRequest, requireAuthenticated, validateRequest(createVybeOfferingSchema), createVybeOfferingController);
vybeCatalogueRouter.patch("/vybe/offerings/:id/draft", authenticateRequest, requireAuthenticated, validateRequest(updateVybeOfferingDraftSchema), updateVybeOfferingDraftController);
vybeCatalogueRouter.post("/vybe/offerings/:id/publish", authenticateRequest, requireAuthenticated, validateRequest(publishVybeOfferingSchema), publishVybeOfferingController);
vybeCatalogueRouter.patch(
  "/vybe/catalogue/categories/:category/activation",
  authenticateRequest,
  requireAuthenticated,
  requirePermission("platform:vybe:catalogue:manage"),
  validateRequest(activateVybeCategorySchema),
  activateVybeCategoryController
);

import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import {
  getMyVybeBookingController,
  listMyVybeBookingsController
} from "./vybe-bookings.reads.controller.js";
import {
  getMyVybeBookingSchema,
  listMyVybeBookingsSchema
} from "./vybe-bookings.reads.validators.js";

export const vybeBookingReadsRouter = Router();

vybeBookingReadsRouter.get(
  "/vybe/bookings",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(listMyVybeBookingsSchema),
  listMyVybeBookingsController
);

vybeBookingReadsRouter.get(
  "/vybe/bookings/:bookingId",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(getMyVybeBookingSchema),
  getMyVybeBookingController
);

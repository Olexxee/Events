import { Router } from "express";
import { authenticateRequest } from "../identity/identity.authentication.js";
import { requireAuthenticated } from "../../shared/middleware/authentication.js";
import { validateRequest } from "../../shared/middleware/validate-request.js";
import { cancelMyVybeBookingController } from "./vybe-bookings.cancellations.controller.js";
import { cancelMyVybeBookingSchema } from "./vybe-bookings.cancellations.validators.js";

export const vybeBookingCancellationsRouter = Router();

vybeBookingCancellationsRouter.post(
  "/vybe/bookings/:bookingId/cancellation",
  authenticateRequest,
  requireAuthenticated,
  validateRequest(cancelMyVybeBookingSchema),
  cancelMyVybeBookingController
);

import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  getMyVybeBooking,
  listMyVybeBookings
} from "./vybe-bookings.reads.service.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

export const listMyVybeBookingsController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const query = getValidatedRequest<{
      query: {
        status?: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
        limit: number;
        cursor?: string;
      };
    }>(res).query;
    const result = await listMyVybeBookings({
      customerUserId: auth.subjectId,
      ...query
    });
    return successResponse(res, result);
  } catch (error) {
    return next(error);
  }
};

export const getMyVybeBookingController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const { bookingId } = getValidatedRequest<{
      params: { bookingId: string };
    }>(res).params;
    const booking = await getMyVybeBooking({
      bookingId,
      customerUserId: auth.subjectId
    });
    return successResponse(res, { booking });
  } catch (error) {
    return next(error);
  }
};

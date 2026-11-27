import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import { getMyVybeBooking } from "./vybe-bookings.reads.service.js";
import { cancelMyVybeBookingService } from "./vybe-bookings.cancellations.service.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

function cancellationError(code: string | null): AppError {
  switch (code) {
    case "VYBE_BOOKING_CANCELLATION_POLICY_UNSUPPORTED":
      return new AppError(
        code,
        "This booking does not have a supported cancellation policy",
        409
      );
    case "VYBE_BOOKING_CANCELLATION_NOT_ALLOWED":
      return new AppError(
        code,
        "The accepted booking policy does not allow customer cancellation",
        409
      );
    case "VYBE_BOOKING_CANCELLATION_CUTOFF_PASSED":
      return new AppError(
        code,
        "The customer cancellation cutoff has passed",
        409
      );
    case "VYBE_BOOKING_NOT_CANCELLABLE":
      return new AppError(
        code,
        "This booking is not in a cancellable state",
        409
      );
    default:
      return new AppError(
        code ?? "VYBE_BOOKING_CANCELLATION_REJECTED",
        "The booking cancellation request was rejected",
        409
      );
  }
}

export const cancelMyVybeBookingController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const validated = getValidatedRequest<{
      params: { bookingId: string };
      body: { idempotencyKey: string; reason: string };
    }>(res);
    const result = await cancelMyVybeBookingService({
      bookingId: validated.params.bookingId,
      customerUserId: auth.subjectId,
      idempotencyKey: validated.body.idempotencyKey,
      reason: validated.body.reason
    });

    if (result.cancellation.decision === "REJECTED") {
      return next(cancellationError(result.cancellation.decisionCode));
    }

    const booking = await getMyVybeBooking({
      bookingId: validated.params.bookingId,
      customerUserId: auth.subjectId
    });
    return successResponse(res, {
      booking,
      cancellation: {
        decision: result.cancellation.decision,
        decidedAt: result.cancellation.decidedAt,
        replayed: result.replayed,
        refund: "handled_separately"
      }
    });
  } catch (error) {
    return next(error);
  }
};

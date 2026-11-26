import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  addVybeTimeSlotResourceGroupMember,
  createVybeTimeSlotCapacityHold,
  createVybeTimeSlotOccurrence,
  createVybeTimeSlotResource,
  createVybeTimeSlotResourceGroup,
  getVybeTimeSlotAvailability,
  releaseVybeTimeSlotCapacityHold
} from "./vybe-time-slots.service.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

export const getVybeTimeSlotAvailabilityController: RequestHandler = async (
  _req,
  res,
  next
) => {
  try {
    const { occurrenceId } = getValidatedRequest<{
      params: { occurrenceId: string };
    }>(res).params;
    const availability = await getVybeTimeSlotAvailability(occurrenceId);
    return successResponse(res, { availability });
  } catch (error) {
    return next(error);
  }
};

export const createVybeTimeSlotCapacityHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{
      body: {
        occurrenceId: string;
        quantity: number;
        idempotencyKey: string;
      };
    }>(res).body;
    const hold = await createVybeTimeSlotCapacityHold({
      ...body,
      userId: auth.subjectId
    });
    return successResponse(res, { hold }, 201);
  } catch (error) {
    return next(error);
  }
};

export const releaseVybeTimeSlotCapacityHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { holdId } = getValidatedRequest<{ params: { holdId: string } }>(
      res
    ).params;
    const hold = await releaseVybeTimeSlotCapacityHold({
      holdId,
      userId: auth.subjectId
    });
    return successResponse(res, { hold });
  } catch (error) {
    return next(error);
  }
};

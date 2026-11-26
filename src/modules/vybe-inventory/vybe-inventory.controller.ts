import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  adjustVybeInventoryAllocation,
  createVybeInventoryHold,
  createVybeInventoryPool,
  getVybeInventoryAvailability,
  releaseVybeInventoryHold
} from "./vybe-inventory.service.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth)
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return req.auth;
}

export const createVybeInventoryPoolController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{
      body: {
        organizationId: string;
        offeringId: string;
        allocatedQuantity: number;
        reason: string;
        evidenceReference: string;
      };
    }>(res).body;
    const pool = await createVybeInventoryPool({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { pool }, 201);
  } catch (error) {
    return next(error);
  }
};

export const adjustVybeInventoryAllocationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { poolId } = getValidatedRequest<{ params: { poolId: string } }>(
      res
    ).params;
    const body = getValidatedRequest<{
      body: {
        quantityDelta: number;
        reason: string;
        evidenceReference: string;
      };
    }>(res).body;
    const pool = await adjustVybeInventoryAllocation({
      ...body,
      poolId,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { pool });
  } catch (error) {
    return next(error);
  }
};

export const getVybeInventoryAvailabilityController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { offeringId } = getValidatedRequest<{
      params: { offeringId: string };
    }>(res).params;
    const availability = await getVybeInventoryAvailability(offeringId);
    return successResponse(res, { availability });
  } catch (error) {
    return next(error);
  }
};

export const createVybeInventoryHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{
      body: { offeringId: string; quantity: number; idempotencyKey: string };
    }>(res).body;
    const hold = await createVybeInventoryHold({
      ...body,
      userId: auth.subjectId
    });
    return successResponse(res, { hold }, 201);
  } catch (error) {
    return next(error);
  }
};

export const releaseVybeInventoryHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { holdId } = getValidatedRequest<{ params: { holdId: string } }>(
      res
    ).params;
    const hold = await releaseVybeInventoryHold({
      holdId,
      userId: auth.subjectId
    });
    return successResponse(res, { hold });
  } catch (error) {
    return next(error);
  }
};

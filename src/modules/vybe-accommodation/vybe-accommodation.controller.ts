import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  adjustVybeAccommodationAllocationNight,
  createVybeAccommodationHold,
  getMyVybeAccommodationHold,
  getVybeAccommodationAvailability,
  releaseMyVybeAccommodationHold,
  createVybeAccommodationAllocation,
  createVybeAccommodationProperty,
  createVybeAccommodationRoomCategory,
  listMyVybeAccommodationProperties,
  releaseVybeAccommodationAllocation,
  updateVybeAccommodationPhysicalCapacity
} from "./vybe-accommodation.service.js";
import type {
  AdjustAccommodationAllocationNightBody,
  CreateAccommodationAllocationBody,
  CreateAccommodationPropertyBody,
  CreateAccommodationRoomCategoryBody,
  CreateAccommodationHoldBody,
  GetAccommodationAvailabilityQuery,
  ReleaseAccommodationAllocationBody,
  UpdateAccommodationCapacityBody
} from "./vybe-accommodation.validators.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

export const createVybeAccommodationPropertyController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{ body: CreateAccommodationPropertyBody }>(
      res
    ).body;
    const property = await createVybeAccommodationProperty({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { property }, 201);
  } catch (error) {
    return next(error);
  }
};

export const listMyVybeAccommodationPropertiesController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const properties = await listMyVybeAccommodationProperties(
        auth.subjectId
      );
      return successResponse(res, { properties });
    } catch (error) {
      return next(error);
    }
  };

export const createVybeAccommodationRoomCategoryController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const { propertyId } = getValidatedRequest<{
        params: { propertyId: string };
      }>(res).params;
      const body = getValidatedRequest<{
        body: CreateAccommodationRoomCategoryBody;
      }>(res).body;
      const roomCategory = await createVybeAccommodationRoomCategory({
        ...body,
        propertyId,
        actorUserId: auth.subjectId
      });
      return successResponse(res, { roomCategory }, 201);
    } catch (error) {
      return next(error);
    }
  };

export const updateVybeAccommodationCapacityController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { roomCategoryId } = getValidatedRequest<{
      params: { roomCategoryId: string };
    }>(res).params;
    const body = getValidatedRequest<{
      body: UpdateAccommodationCapacityBody;
    }>(res).body;
    const roomCategory = await updateVybeAccommodationPhysicalCapacity({
      ...body,
      roomCategoryId,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { roomCategory });
  } catch (error) {
    return next(error);
  }
};

export const createVybeAccommodationAllocationController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const { roomCategoryId } = getValidatedRequest<{
        params: { roomCategoryId: string };
      }>(res).params;
      const body = getValidatedRequest<{
        body: CreateAccommodationAllocationBody;
      }>(res).body;
      const allocation = await createVybeAccommodationAllocation({
        ...body,
        roomCategoryId,
        actorUserId: auth.subjectId
      });
      return successResponse(res, { allocation }, 201);
    } catch (error) {
      return next(error);
    }
  };

export const adjustVybeAccommodationAllocationNightController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const { allocationNightId } = getValidatedRequest<{
        params: { allocationNightId: string };
      }>(res).params;
      const body = getValidatedRequest<{
        body: AdjustAccommodationAllocationNightBody;
      }>(res).body;
      const result = await adjustVybeAccommodationAllocationNight({
        ...body,
        allocationNightId,
        actorUserId: auth.subjectId
      });
      return successResponse(res, result);
    } catch (error) {
      return next(error);
    }
  };

export const releaseVybeAccommodationAllocationController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const { allocationId } = getValidatedRequest<{
        params: { allocationId: string };
      }>(res).params;
      const body = getValidatedRequest<{
        body: ReleaseAccommodationAllocationBody;
      }>(res).body;
      const allocation = await releaseVybeAccommodationAllocation({
        ...body,
        allocationId,
        actorUserId: auth.subjectId
      });
      return successResponse(res, { allocation });
    } catch (error) {
      return next(error);
    }
  };

export const getVybeAccommodationAvailabilityController: RequestHandler =
  async (req, res, next) => {
    try {
      const { roomCategoryId } = getValidatedRequest<{
        params: { roomCategoryId: string };
      }>(res).params;
      const query = getValidatedRequest<{
        query: GetAccommodationAvailabilityQuery;
      }>(res).query;
      const availability = await getVybeAccommodationAvailability({
        roomCategoryId,
        ...query
      });
      return successResponse(res, { availability });
    } catch (error) {
      return next(error);
    }
  };

export const createVybeAccommodationHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{
      body: CreateAccommodationHoldBody;
    }>(res).body;
    const hold = await createVybeAccommodationHold({
      ...body,
      userId: auth.subjectId
    });
    return successResponse(res, { hold }, 201);
  } catch (error) {
    return next(error);
  }
};

export const getMyVybeAccommodationHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { holdId } = getValidatedRequest<{
      params: { holdId: string };
    }>(res).params;
    const hold = await getMyVybeAccommodationHold({
      holdId,
      userId: auth.subjectId
    });
    return successResponse(res, { hold });
  } catch (error) {
    return next(error);
  }
};

export const releaseMyVybeAccommodationHoldController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { holdId } = getValidatedRequest<{
      params: { holdId: string };
    }>(res).params;
    const hold = await releaseMyVybeAccommodationHold({
      holdId,
      userId: auth.subjectId
    });
    return successResponse(res, { hold });
  } catch (error) {
    return next(error);
  }
};

import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  addVybeTimeSlotResourceGroupMember,
  createVybeTimeSlotOccurrence,
  createVybeTimeSlotResource,
  createVybeTimeSlotResourceGroup
} from "./vybe-time-slots.service.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

export const createVybeTimeSlotOccurrenceController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{ body: {
      offeringId: string;
      inventoryMode: "CAPACITY" | "EXCLUSIVE";
      timezone: string;
      serviceStartsAt: string;
      serviceEndsAt: string;
      preBufferSeconds: number;
      postBufferSeconds: number;
      capacity?: number;
      resourceGroupId?: string;
      supplyEvidenceReference: string;
    } }>(res).body;
    const occurrence = await createVybeTimeSlotOccurrence({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { occurrence }, 201);
  } catch (error) {
    return next(error);
  }
};

export const createVybeTimeSlotResourceGroupController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{ body: {
      offeringId: string;
      name: string;
      validFrom?: string;
      validUntil?: string;
      supplyEvidenceReference: string;
    } }>(res).body;
    const resourceGroup = await createVybeTimeSlotResourceGroup({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { resourceGroup }, 201);
  } catch (error) {
    return next(error);
  }
};

export const createVybeTimeSlotResourceController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{ body: {
      offeringId: string;
      providerResourceKey: string;
      name: string;
      supplyEvidenceReference: string;
    } }>(res).body;
    const resource = await createVybeTimeSlotResource({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { resource }, 201);
  } catch (error) {
    return next(error);
  }
};

export const addVybeTimeSlotResourceGroupMemberController: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const { groupId } = getValidatedRequest<{ params: { groupId: string } }>(res).params;
    const body = getValidatedRequest<{ body: {
      resourceId: string;
      validFrom?: string;
      validUntil?: string;
      supplyEvidenceReference: string;
    } }>(res).body;
    const membership = await addVybeTimeSlotResourceGroupMember({
      ...body,
      groupId,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { membership }, 201);
  } catch (error) {
    return next(error);
  }
};

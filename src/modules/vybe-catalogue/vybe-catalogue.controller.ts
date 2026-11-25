import type { RequestHandler } from "express";
import type { VybeCategory } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  createVybeOffering,
  discoverVybeOfferings,
  publishVybeOffering,
  setVybeCategoryActivation,
  updateVybeOffering
} from "./vybe-catalogue.service.js";
import type { VybeOfferingContent } from "./vybe-catalogue.validators.js";

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }
  return req.auth;
}

type IdParams = { params: { id: string } };
type CategoryParams = { params: { category: VybeCategory } };

export const createVybeOfferingController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const body = getValidatedRequest<{
      body: {
        organizationId: string;
        category: VybeCategory;
        content: VybeOfferingContent;
      };
    }>(res).body;
    const offering = await createVybeOffering({
      ...body,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { offering }, 201);
  } catch (error) {
    return next(error);
  }
};

export const updateVybeOfferingDraftController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { id } = getValidatedRequest<IdParams>(res).params;
    const { content } = getValidatedRequest<{
      body: { content: VybeOfferingContent };
    }>(res).body;
    const result = await updateVybeOffering({
      offeringId: id,
      actorUserId: auth.subjectId,
      content
    });
    return successResponse(res, result);
  } catch (error) {
    return next(error);
  }
};

export const publishVybeOfferingController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { id } = getValidatedRequest<IdParams>(res).params;
    const offering = await publishVybeOffering({
      offeringId: id,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { offering });
  } catch (error) {
    return next(error);
  }
};

export const activateVybeCategoryController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { category } = getValidatedRequest<CategoryParams>(res).params;
    const body = getValidatedRequest<{
      body: {
        active: boolean;
        reason: string;
        checks: {
          key: string;
          completed: true;
          evidenceReference: string;
          notes: string;
        }[];
      };
    }>(res).body;
    const activation = await setVybeCategoryActivation({
      ...body,
      category,
      actorUserId: auth.subjectId
    });
    return successResponse(res, { activation });
  } catch (error) {
    return next(error);
  }
};

export const listVybeCatalogueController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const query = getValidatedRequest<{
      query: {
        category?: VybeCategory;
        city?: string;
        state?: string;
      };
    }>(res).query;
    const offerings = await discoverVybeOfferings(query);
    return successResponse(res, { offerings });
  } catch (error) {
    return next(error);
  }
};

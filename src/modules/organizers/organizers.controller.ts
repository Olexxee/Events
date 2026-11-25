import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  applyForOrganizerAccess,
  getMyOrganizerApplications,
  getOrganizerApplications,
  reviewOrganizerApplication
} from "./organizers.service.js";

export const submitOrganizerApplicationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    }
    const input = getValidatedRequest<{
      body: {
        organizationId: string;
        applicationMessage: string;
        websiteUrl?: string;
      };
    }>(res).body;
    const application = await applyForOrganizerAccess({
      ...input,
      applicantUserId: req.auth.subjectId
    });
    return successResponse(res, { application }, 201);
  } catch (error) {
    return next(error);
  }
};

export const myOrganizerApplicationsController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    }
    const applications = await getMyOrganizerApplications(req.auth.subjectId);
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const organizerApplicationsQueueController: RequestHandler = async (
  _req,
  res,
  next
) => {
  try {
    const applications = await getOrganizerApplications();
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const decideOrganizerApplicationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    }
    const { id } = getValidatedRequest<{
      params: { id: string };
    }>(res).params;
    const input = getValidatedRequest<{
      body: { decision: "APPROVED" | "REJECTED"; reason: string };
    }>(res).body;
    const application = await reviewOrganizerApplication({
      applicationId: id,
      reviewerUserId: req.auth.subjectId,
      ...input
    });
    return successResponse(res, { application });
  } catch (error) {
    return next(error);
  }
};

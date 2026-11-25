import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  applyToBecomeVybeProvider,
  decideVybeProviderApplication,
  getMyVybeProviderApplications,
  getVybeProviderApplicationQueue,
  submitAdditionalVybeProviderEvidence
} from "./vybe-provider.service.js";

export const submitVybeProviderApplicationController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    const input = getValidatedRequest<{
      body: {
        organizationId: string;
        category: "ACCOMMODATION" | "DINING" | "DRINKS" | "TABLES_LOUNGES" | "VIP_EXPERIENCES" | "OTHER_SERVICES";
        serviceDescription: string;
        supplyAuthorityStatement: string;
        supplyAuthorityAttested: true;
        termsVersion: string;
        locations: { city: string; state: string; country: string }[];
        evidence?: { evidenceType: string; requirementReason: string; storageReference: string }[];
      };
    }>(res).body;
    const application = await applyToBecomeVybeProvider({
      ...input,
      applicantUserId: req.auth.subjectId
    });
    return successResponse(res, { application }, 201);
  } catch (error) {
    return next(error);
  }
};

export const myVybeProviderApplicationsController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    const applications = await getMyVybeProviderApplications(req.auth.subjectId);
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const vybeProviderApplicationQueueController: RequestHandler = async (_req, res, next) => {
  try {
    const applications = await getVybeProviderApplicationQueue();
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const reviewVybeProviderApplicationController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    const { id } = getValidatedRequest<{ params: { id: string } }>(res).params;
    const input = getValidatedRequest<{
      body: {
        decision: "UNDER_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED";
        reason: string;
        conditions?: string[];
        expiresAt?: string;
        evidenceDecisions?: { evidenceId: string; status: "ACCEPTED" | "REJECTED"; reason: string }[];
      };
    }>(res).body;
    const application = await decideVybeProviderApplication({
      applicationId: id,
      reviewerUserId: req.auth.subjectId,
      ...input
    });
    return successResponse(res, { application });
  } catch (error) {
    return next(error);
  }
};

export const addVybeProviderEvidenceController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    const { id } = getValidatedRequest<{ params: { id: string } }>(res).params;
    const { evidence } = getValidatedRequest<{
      body: { evidence: { evidenceType: string; requirementReason: string; storageReference: string }[] };
    }>(res).body;
    const records = await submitAdditionalVybeProviderEvidence({
      applicationId: id,
      applicantUserId: req.auth.subjectId,
      evidence
    });
    return successResponse(res, { evidence: records }, 201);
  } catch (error) {
    return next(error);
  }
};

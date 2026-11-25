import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import {
  applyToBecomeVybeProvider,
  decideVybeProviderApplication,
  getMyVybeProviderApplications,
  getVybeProviderApplicationQueue,
  submitAdditionalVybeProviderEvidence,
  updateVybeProviderApprovalStatus
} from "./vybe-provider.service.js";

type ApplicationIdParams = {
  params: { id: string };
};

type SubmitApplicationBody = {
  organizationId: string;
  category:
    | "ACCOMMODATION"
    | "DINING"
    | "DRINKS"
    | "TABLES_LOUNGES"
    | "VIP_EXPERIENCES"
    | "OTHER_SERVICES";
  serviceDescription: string;
  supplyAuthorityStatement: string;
  supplyAuthorityAttested: true;
  termsAccepted: true;
  locations: { city: string; state: string; country: string }[];
  evidence?: {
    evidenceType: string;
    requirementReason: string;
    storageReference: string;
  }[];
};

type ReviewApplicationBody = {
  decision: "UNDER_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED";
  reason: string;
  conditions?: string[];
  expiresAt?: string;
  evidenceDecisions?: {
    evidenceId: string;
    status: "ACCEPTED" | "REJECTED";
    reason: string;
  }[];
};

type AddEvidenceBody = {
  evidence: {
    evidenceType: string;
    requirementReason: string;
    storageReference: string;
  }[];
};

type ChangeApprovalStatusBody = {
  action: "SUSPENDED" | "REVOKED";
  reason: string;
};

function requireAuth(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) {
    throw new AppError(
      "UNAUTHENTICATED",
      "Authentication is required",
      401
    );
  }
  return req.auth;
}

export const submitVybeProviderApplicationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const input = getValidatedRequest<{ body: SubmitApplicationBody }>(
      res
    ).body;
    const application = await applyToBecomeVybeProvider({
      ...input,
      applicantUserId: auth.subjectId
    });
    return successResponse(res, { application }, 201);
  } catch (error) {
    return next(error);
  }
};

export const myVybeProviderApplicationsController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const applications = await getMyVybeProviderApplications(
      auth.subjectId
    );
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const vybeProviderApplicationQueueController: RequestHandler = async (
  _req,
  res,
  next
) => {
  try {
    const applications = await getVybeProviderApplicationQueue();
    return successResponse(res, { applications });
  } catch (error) {
    return next(error);
  }
};

export const reviewVybeProviderApplicationController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { id } = getValidatedRequest<ApplicationIdParams>(res).params;
    const input = getValidatedRequest<{ body: ReviewApplicationBody }>(
      res
    ).body;
    const application = await decideVybeProviderApplication({
      applicationId: id,
      reviewerUserId: auth.subjectId,
      ...input
    });
    return successResponse(res, { application });
  } catch (error) {
    return next(error);
  }
};

export const addVybeProviderEvidenceController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const auth = requireAuth(req);
    const { id } = getValidatedRequest<ApplicationIdParams>(res).params;
    const { evidence } = getValidatedRequest<{ body: AddEvidenceBody }>(
      res
    ).body;
    const records = await submitAdditionalVybeProviderEvidence({
      applicationId: id,
      applicantUserId: auth.subjectId,
      evidence
    });
    return successResponse(res, { evidence: records }, 201);
  } catch (error) {
    return next(error);
  }
};

export const changeVybeProviderApprovalStatusController: RequestHandler =
  async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const { id } = getValidatedRequest<ApplicationIdParams>(res).params;
      const input = getValidatedRequest<{
        body: ChangeApprovalStatusBody;
      }>(res).body;
      const approval = await updateVybeProviderApprovalStatus({
        approvalId: id,
        reviewerUserId: auth.subjectId,
        ...input
      });
      return successResponse(res, { approval });
    } catch (error) {
      return next(error);
    }
  };

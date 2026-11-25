import type { RequestHandler, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import * as service from "./event-access.service.js";

function actor(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return req.auth.subjectId;
}
function run(fn: (req: Parameters<RequestHandler>[0], res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res, next) => {
    try { return successResponse(res, await fn(req, res)); } catch (error) { return next(error); }
  };
}
export const submitRequestController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { eventId: string }; body: { message?: string } }>(res);
  return { request: await service.submitRequest(params.eventId, actor(req), body.message) };
});
export const myAccessController = run(async (req, res) => {
  const { params } = getValidatedRequest<{ params: { eventId: string } }>(res);
  return { access: await service.myAccess(params.eventId, actor(req)) };
});
export const withdrawRequestController = run(async (req, res) => {
  const { params } = getValidatedRequest<{ params: { requestId: string } }>(res);
  return { request: await service.withdrawRequest(params.requestId, actor(req)) };
});
export const listRequestsController = run(async (req, res) => {
  const { params } = getValidatedRequest<{ params: { organizationId: string; eventId: string } }>(res);
  return { requests: await service.listRequests(params.eventId, params.organizationId, actor(req)) };
});
export const decideRequestController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { organizationId: string; eventId: string; requestId: string }; body: { decision: "APPROVED" | "REJECTED"; reason: string } }>(res);
  return { decision: await service.decideRequest({ requestId: params.requestId, eventId: params.eventId, organizationId: params.organizationId, actorId: actor(req), ...body }) };
});
export const issueInvitationController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { organizationId: string; eventId: string }; body: { recipientEmail: string; expiresInDays?: number } }>(res);
  return await service.issueInvitation({ eventId: params.eventId, organizationId: params.organizationId, actorId: actor(req), ...body });
});
export const invitationAcceptController = run(async (req, res) => {
  const { params } = getValidatedRequest<{ params: { token: string } }>(res);
  return { invitation: await service.respondToInvitation(params.token, actor(req), "ACCEPTED") };
});
export const invitationDeclineController = run(async (req, res) => {
  const { params } = getValidatedRequest<{ params: { token: string } }>(res);
  return { invitation: await service.respondToInvitation(params.token, actor(req), "DECLINED") };
});
export const revokeGrantController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { organizationId: string; eventId: string; grantId: string }; body: { reason: string } }>(res);
  return { grant: await service.revokeGrant({ grantId: params.grantId, eventId: params.eventId, organizationId: params.organizationId, actorId: actor(req), reason: body.reason }) };
});
export const placeHoldController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { eventId: string }; body: { reason: string } }>(res);
  return { hold: await service.setPlatformHold({ eventId: params.eventId, actorId: actor(req), reason: body.reason, release: false }) };
});
export const releaseHoldController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { eventId: string }; body: { reason: string } }>(res);
  return { hold: await service.setPlatformHold({ eventId: params.eventId, actorId: actor(req), reason: body.reason, release: true }) };
});

export const revokeInvitationController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { organizationId: string; eventId: string; invitationId: string }; body: { reason: string } }>(res);
  return { invitation: await service.revokeInvitation({ invitationId: params.invitationId, eventId: params.eventId, organizationId: params.organizationId, actorId: actor(req), reason: body.reason }) };
});
export const platformRevokeGrantController = run(async (req, res) => {
  const { params, body } = getValidatedRequest<{ params: { eventId: string; grantId: string }; body: { reason: string } }>(res);
  return { grant: await service.revokeGrantByPlatform({ grantId: params.grantId, eventId: params.eventId, actorId: actor(req), reason: body.reason }) };
});

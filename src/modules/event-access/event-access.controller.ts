import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import * as service from "./event-access.service.js";
const actor = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return req.auth.subjectId;
};
const run = (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { return successResponse(res, await fn(req)); } catch (error) { return next(error); }
};
export const submitRequestController = run(async (req) => {
  const p = getValidatedRequest<{ params: { eventId: string }; body: { message?: string } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { message?: string } }>(req.res!).body;
  return { request: await service.submitRequest(p.eventId, actor(req), b.message) };
});
export const myAccessController = run(async (req) => {
  const p = getValidatedRequest<{ params: { eventId: string } }>(req.res!).params;
  return { access: await service.myAccess(p.eventId, actor(req)) };
});
export const withdrawRequestController = run(async (req) => {
  const p = getValidatedRequest<{ params: { requestId: string } }>(req.res!).params;
  return { request: await service.withdrawRequest(p.requestId, actor(req)) };
});
export const listRequestsController = run(async (req) => {
  const p = getValidatedRequest<{ params: { organizationId: string; eventId: string } }>(req.res!).params;
  return { requests: await service.listRequests(p.eventId, p.organizationId, actor(req)) };
});
export const decideRequestController = run(async (req) => {
  const p = getValidatedRequest<{ params: { organizationId: string; eventId: string; requestId: string }; body: { decision: "APPROVED" | "REJECTED"; reason: string } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { decision: "APPROVED" | "REJECTED"; reason: string } }>(req.res!).body;
  return { decision: await service.decideRequest({ requestId: p.requestId, eventId: p.eventId, organizationId: p.organizationId, actorId: actor(req), ...b }) };
});
export const issueInvitationController = run(async (req) => {
  const p = getValidatedRequest<{ params: { organizationId: string; eventId: string }; body: { recipientEmail: string; expiresInDays?: number } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { recipientEmail: string; expiresInDays?: number } }>(req.res!).body;
  return await service.issueInvitation({ eventId: p.eventId, organizationId: p.organizationId, actorId: actor(req), ...b });
});
export const invitationAcceptController = run(async (req) => {
  const p = getValidatedRequest<{ params: { token: string } }>(req.res!).params;
  return { invitation: await service.respondToInvitation(p.token, actor(req), "ACCEPTED") };
});
export const invitationDeclineController = run(async (req) => {
  const p = getValidatedRequest<{ params: { token: string } }>(req.res!).params;
  return { invitation: await service.respondToInvitation(p.token, actor(req), "DECLINED") };
});
export const revokeGrantController = run(async (req) => {
  const p = getValidatedRequest<{ params: { organizationId: string; eventId: string; grantId: string }; body: { reason: string } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { reason: string } }>(req.res!).body;
  return { grant: await service.revokeGrant({ ...p, actorId: actor(req), ...b }) };
});
export const placeHoldController = run(async (req) => {
  const p = getValidatedRequest<{ params: { eventId: string }; body: { reason: string } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { reason: string } }>(req.res!).body;
  return { hold: await service.setPlatformHold({ eventId: p.eventId, actorId: actor(req), reason: b.reason, release: false }) };
});
export const releaseHoldController = run(async (req) => {
  const p = getValidatedRequest<{ params: { eventId: string } }>(req.res!).params;
  const b = getValidatedRequest<{ body: { reason: string } }>(req.res!).body;
  return { hold: await service.setPlatformHold({ eventId: p.eventId, actorId: actor(req), reason: b.reason, release: true }) };
});

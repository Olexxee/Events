import type { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import * as service from "./ticketing.service.js";

function actor(req: Parameters<RequestHandler>[0]) {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return req.auth.subjectId;
}
export const createTicketTypeController: RequestHandler = async (req, res, next) => {
  try {
    const parsed = getValidatedRequest<{
      params: { eventId: string };
      body: Omit<Parameters<typeof service.createTicketType>[0], "eventId" | "actorUserId" | "benefits"> & { benefits: unknown };
    }>(res);
    const ticketType = await service.createTicketType({
      ...parsed.body,
      benefits: JSON.parse(JSON.stringify(parsed.body.benefits)) as Prisma.InputJsonValue,
      eventId: parsed.params.eventId,
      actorUserId: actor(req)
    });
    return successResponse(res, { ticketType }, 201);
  } catch (error) { return next(error); }
};
export const listTicketTypesController: RequestHandler = async (req, res, next) => {
  try {
    const { eventId } = getValidatedRequest<{ params: { eventId: string } }>(res).params;
    return successResponse(res, { ticketTypes: await service.listTicketTypes(eventId, actor(req)) });
  } catch (error) { return next(error); }
};
export const listManagedTicketTypesController: RequestHandler = async (req, res, next) => {
  try {
    const { eventId } = getValidatedRequest<{ params: { eventId: string } }>(res).params;
    return successResponse(res, { ticketTypes: await service.listManagedTicketTypes(eventId, actor(req)) });
  } catch (error) { return next(error); }
};
export const createHoldController: RequestHandler = async (req, res, next) => {
  try {
    const parsed = getValidatedRequest<{
      params: { eventId: string };
      body: Parameters<typeof service.createHold>[0] extends infer T ? Omit<T, "eventId" | "userId"> : never;
    }>(res);
    const hold = await service.createHold({
      ...parsed.body,
      eventId: parsed.params.eventId,
      userId: actor(req)
    });
    return successResponse(res, { hold }, 201);
  } catch (error) { return next(error); }
};
export const releaseHoldController: RequestHandler = async (req, res, next) => {
  try {
    const { id } = getValidatedRequest<{ params: { id: string } }>(res).params;
    return successResponse(res, { hold: await service.releaseHold(id, actor(req)) });
  } catch (error) { return next(error); }
};

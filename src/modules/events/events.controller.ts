import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { getValidatedRequest } from "../../shared/middleware/validate-request.js";
import { successResponse } from "../../shared/responses/success-response.js";
import * as service from "./events.service.js";

function actor(req: Parameters<RequestHandler>[0]) {
  if (!req.auth)
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return req.auth.subjectId;
}

export const categoriesController: RequestHandler = async (_req, res, next) => {
  try {
    return successResponse(res, {
      categories: await service.getEventCategories()
    });
  } catch (error) {
    return next(error);
  }
};
export const createEventController: RequestHandler = async (req, res, next) => {
  try {
    const body = getValidatedRequest<{
      body: Omit<Parameters<typeof service.createEventDraft>[0], "actorUserId">;
    }>(res).body;
    const event = await service.createEventDraft({
      ...body,
      actorUserId: actor(req)
    });
    return successResponse(res, { event }, 201);
  } catch (error) {
    return next(error);
  }
};
export const updateEventController: RequestHandler = async (req, res, next) => {
  try {
    const id = getValidatedRequest<{ params: { id: string } }>(res).params.id;
    const body = getValidatedRequest<{
      body: Omit<
        Parameters<typeof service.updateEventDraft>[0],
        "eventId" | "actorUserId"
      >;
    }>(res).body;
    const event = await service.updateEventDraft({
      ...body,
      eventId: id,
      actorUserId: actor(req)
    });
    return successResponse(res, { event });
  } catch (error) {
    return next(error);
  }
};
export const publishEventController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const id = getValidatedRequest<{ params: { id: string } }>(res).params.id;
    return successResponse(res, {
      event: await service.publishEvent(id, actor(req))
    });
  } catch (error) {
    return next(error);
  }
};
export const managedEventsController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || !organizationId) {
      throw new AppError(
        "ORGANIZATION_CONTEXT_REQUIRED",
        "Organization context is required",
        400
      );
    }
    return successResponse(res, {
      events: await service.getManagedEvents(organizationId, actor(req))
    });
  } catch (error) {
    return next(error);
  }
};
export const managedEventController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const id = getValidatedRequest<{ params: { id: string } }>(res).params.id;
    return successResponse(res, {
      event: await service.getManagedEvent(id, actor(req))
    });
  } catch (error) {
    return next(error);
  }
};
export const discoverEventsController: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const query = getValidatedRequest<{
      query: Parameters<typeof service.discoverEvents>[0];
    }>(res).query;
    return successResponse(res, await service.discoverEvents(query));
  } catch (error) {
    return next(error);
  }
};
export const publicEventController: RequestHandler = async (req, res, next) => {
  try {
    const id = getValidatedRequest<{ params: { id: string } }>(res).params.id;
    return successResponse(res, { event: await service.getPublicEvent(id) });
  } catch (error) {
    return next(error);
  }
};

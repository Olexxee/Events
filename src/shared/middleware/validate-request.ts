import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";

export const validateRequest = <T>(schema: ZodType<T>): RequestHandler => {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query
    });

    if (!result.success) {
      return next(result.error);
    }

    res.locals.validatedRequest = result.data;
    return next();
  };
};

export function getValidatedRequest<T>(res: Response): T {
  const value: unknown = res.locals.validatedRequest;

  if (value === undefined) {
    throw new Error("Validated request data is unavailable");
  }

  return value as T;
}

import type { Response } from "express";

export function successResponse<T>(
  res: Response,
  data: T,
  statusCode = 200
): Response {
  return res.status(statusCode).json({ success: true, data });
}

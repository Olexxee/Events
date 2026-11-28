import type { RequestHandler } from "express";

export function parseCorsOrigins(value: string): string[] {
  return [...new Set(value.split(",").map((origin) => origin.trim()).filter(Boolean))];
}

export function corsMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
      res.setHeader("Vary", "Origin");
    } else if (origin) {
      return res.status(403).json({
        success: false,
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This origin is not allowed", details: [] }
      });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}

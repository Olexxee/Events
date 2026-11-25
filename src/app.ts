import express, { type Express } from "express";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { notFoundHandler } from "./shared/middleware/not-found.js";
import { successResponse } from "./shared/responses/success-response.js";
import { pingDatabase } from "./infrastructure/database/prisma.js";

export interface AppDependencies {
  databasePing?: () => Promise<void>;
  apiPrefix?: string;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const prefix = dependencies.apiPrefix ?? "/api/v1";
  const databasePing = dependencies.databasePing ?? pingDatabase;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => successResponse(res, { status: "ok" }));

  app.get(`${prefix}/health/ready`, async (_req, res) => {
    await databasePing();
    return successResponse(res, { status: "ready", database: "connected" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

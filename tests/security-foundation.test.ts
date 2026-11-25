import express from "express";
import request from "supertest";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { requireAuthenticated } from "../src/shared/middleware/authentication.js";
import { errorHandler } from "../src/shared/middleware/error-handler.js";
import { requirePermission } from "../src/shared/middleware/authorization.js";
import {
  getValidatedRequest,
  validateRequest
} from "../src/shared/middleware/validate-request.js";
import { successResponse } from "../src/shared/responses/success-response.js";

function createSecurityTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/protected", requireAuthenticated, (_req, res) =>
    successResponse(res, { allowed: true })
  );

  app.get(
    "/admin",
    (req, _res, next) => {
      req.auth = {
        subjectId: "test-user",
        subjectType: "user",
        permissions: ["admin:read"]
      };
      next();
    },
    requireAuthenticated,
    requirePermission("admin:read"),
    (_req, res) => successResponse(res, { allowed: true })
  );

  app.get(
    "/denied",
    (req, _res, next) => {
      req.auth = {
        subjectId: "test-user",
        subjectType: "user",
        permissions: ["events:read"]
      };
      next();
    },
    requireAuthenticated,
    requirePermission("admin:read"),
    (_req, res) => successResponse(res, { allowed: true })
  );

  app.post(
    "/validated",
    validateRequest(
      z.object({
        body: z.object({ title: z.string().min(3) }),
        params: z.object({}),
        query: z.object({})
      })
    ),
    (req, res) => {
      const data = getValidatedRequest<{
        body: { title: string };
        params: Record<string, never>;
        query: Record<string, never>;
      }>(res);
      return successResponse(res, { title: data.body.title });
    }
  );

  app.use(errorHandler);
  return app;
}

describe("shared security foundation", () => {
  it("rejects requests without a verified principal", async () => {
    const response = await request(createSecurityTestApp()).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("allows a principal with the required permission", async () => {
    const response = await request(createSecurityTestApp()).get("/admin");

    expect(response.status).toBe(200);
    expect(response.body.data.allowed).toBe(true);
  });

  it("denies a principal without the required permission", async () => {
    const response = await request(createSecurityTestApp()).get("/denied");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("validates request parts before exposing typed validated data", async () => {
    const app = createSecurityTestApp();
    const valid = await request(app)
      .post("/validated")
      .send({ title: "Launch" });
    const invalid = await request(app).post("/validated").send({ title: "x" });

    expect(valid.status).toBe(200);
    expect(valid.body.data.title).toBe("Launch");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });
});

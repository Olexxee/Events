import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("API foundation", () => {
  it("exposes a liveness endpoint without requiring the database", async () => {
    const app = createApp({ databasePing: vi.fn() });
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: "ok" }
    });
  });

  it("reports readiness when the database responds", async () => {
    const databasePing = vi.fn().mockResolvedValue(undefined);
    const app = createApp({ databasePing });
    const response = await request(app).get("/api/v1/health/ready");

    expect(response.status).toBe(200);
    expect(databasePing).toHaveBeenCalledOnce();
    expect(response.body.data.database).toBe("connected");
  });

  it("returns a controlled error when the database is unavailable", async () => {
    const app = createApp({
      databasePing: vi
        .fn()
        .mockRejectedValue(new Error("database details must not leak"))
    });
    const response = await request(app).get("/api/v1/health/ready");

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe(
      "An unexpected error occurred"
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "database details"
    );
  });

  it("returns a consistent not-found response", async () => {
    const app = createApp({ databasePing: vi.fn() });
    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

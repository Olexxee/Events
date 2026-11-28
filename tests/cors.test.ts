import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("credentialed CORS policy", () => {
  const app = createApp({
    databasePing: async () => undefined,
    corsOrigins: ["https://events.example.com"]
  });

  it("allows only configured origins and credentials", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "https://events.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://events.example.com"
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers.vary).toContain("Origin");
  });

  it("rejects unconfigured browser origins", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "https://attacker.example");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("handles preflight without reflecting arbitrary origins", async () => {
    const allowed = await request(app)
      .options("/api/v1/auth/refresh")
      .set("Origin", "https://events.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://events.example.com"
    );

    const denied = await request(app)
      .options("/api/v1/auth/refresh")
      .set("Origin", "https://evil.example");

    expect(denied.status).toBe(403);
  });
});

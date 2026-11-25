import { describe, expect, it } from "vitest";
import {
  loginSchema,
  organizationSchema,
  refreshSchema,
  registerSchema
} from "../src/modules/identity/identity.validators.js";

describe("identity request validation", () => {
  it("normalizes email addresses and requires strong password length", () => {
    const result = registerSchema.safeParse({
      body: {
        email: " PERSON@EXAMPLE.COM ",
        password: "a-long-enough-password",
        displayName: "Person"
      },
      params: {},
      query: {}
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.email).toBe("person@example.com");
    }
  });

  it("rejects weak registration passwords", () => {
    const result = registerSchema.safeParse({
      body: { email: "person@example.com", password: "short" },
      params: {},
      query: {}
    });

    expect(result.success).toBe(false);
  });

  it("requires refresh tokens and bounded organization names", () => {
    expect(
      refreshSchema.safeParse({
        body: { refreshToken: "too-short" },
        params: {},
        query: {}
      }).success
    ).toBe(false);

    expect(
      organizationSchema.safeParse({
        body: { name: "A" },
        params: {},
        query: {}
      }).success
    ).toBe(false);
  });

  it("rejects malformed login emails", () => {
    expect(
      loginSchema.safeParse({
        body: { email: "not-an-email", password: "anything" },
        params: {},
        query: {}
      }).success
    ).toBe(false);
  });
});

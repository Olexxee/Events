import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/modules/identity/password.service.js";

describe("identity password hashing", () => {
  it("hashes passwords with a unique salt and verifies the correct password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("incorrect password", first)).toBe(false);
  });

  it("rejects malformed or unsupported password hashes", async () => {
    expect(await verifyPassword("password", "plain-text-password")).toBe(false);
    expect(await verifyPassword("password", "bcrypt$10$invalid")).toBe(false);
  });
});

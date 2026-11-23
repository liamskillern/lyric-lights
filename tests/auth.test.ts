import { describe, expect, it } from "vitest";
import { base64Url, codeChallenge, isValidClientId, randomString, tokensFromResponse } from "../src/auth";

describe("PKCE", () => {
  it("matches the RFC 7636 example", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes verifiers of the right length from the allowed characters", () => {
    const v = randomString(64);
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(randomString(64)).not.toBe(v);
  });

  it("base64url has no padding or +/", () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64Url(new Uint8Array([1]))).toBe("AQ");
  });
});

describe("tokens", () => {
  it("computes expiry and keeps the old refresh token if none is returned", () => {
    const t = tokensFromResponse({ access_token: "a", expires_in: 3600 }, "old", 1000);
    expect(t).toEqual({ accessToken: "a", refreshToken: "old", expiresAt: 3_601_000 });
    expect(tokensFromResponse({ access_token: "a", refresh_token: "new", expires_in: 10 }, "old", 0).refreshToken).toBe("new");
  });

  it("validates client ids", () => {
    expect(isValidClientId("0123456789abcdef0123456789ABCDEF")).toBe(true);
    expect(isValidClientId(" 0123456789abcdef0123456789abcdef ")).toBe(true);
    expect(isValidClientId("nope")).toBe(false);
  });
});

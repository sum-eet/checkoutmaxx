import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// Unmock — setup.ts mocks verify-session-token for other tests but we need the real impl.
// vi.unmock() is hoisted by Vitest before the static import below runs.
vi.unmock("@/lib/verify-session-token");
import { verifySessionToken } from "@/lib/verify-session-token";

const TEST_SECRET = "test-secret-abc";

/** Build a valid App Bridge session token JWT signed with the given secret. */
function makeToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function futureExp() {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastExp() {
  return Math.floor(Date.now() / 1000) - 60;
}

describe("verifySessionToken", () => {
  beforeEach(() => {
    process.env.SHOPIFY_API_SECRET = TEST_SECRET;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null and logs error when SHOPIFY_API_SECRET not set", () => {
    delete process.env.SHOPIFY_API_SECRET;

    const result = verifySessionToken("some.token.value");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("SHOPIFY_API_SECRET not set")
    );
  });

  it("returns null and warns on malformed token (missing segments)", () => {
    const result = verifySessionToken("notadotseperatedtoken");

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("malformed token")
    );
  });

  it("returns null and warns on HMAC mismatch (wrong signature)", () => {
    const token = makeToken(
      { exp: futureExp(), dest: "https://test.myshopify.com" },
      "wrong-secret-xyz"
    );

    const result = verifySessionToken(token);

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("hmac_mismatch")
    );
  });

  it("returns null and warns when token is expired", () => {
    const token = makeToken(
      { exp: pastExp(), dest: "https://test.myshopify.com" },
      TEST_SECRET
    );

    const result = verifySessionToken(token);

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("token expired"),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("returns shop domain for valid token with correct signature and future exp", () => {
    const token = makeToken(
      { exp: futureExp(), dest: "https://test.myshopify.com/admin" },
      TEST_SECRET
    );

    const result = verifySessionToken(token);

    expect(result).toBe("test.myshopify.com");
  });

  it("returns null and warns when dest and iss are both missing", () => {
    const token = makeToken(
      { exp: futureExp(), sub: "some-subject" },
      TEST_SECRET
    );

    const result = verifySessionToken(token);

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing dest")
    );
  });

  it("returns null and warns when dest has no recognizable domain URL", () => {
    const token = makeToken(
      { exp: futureExp(), dest: "garbage-no-url" },
      TEST_SECRET
    );

    const result = verifySessionToken(token);

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("no recognizable domain"),
      expect.any(String)
    );
  });
});

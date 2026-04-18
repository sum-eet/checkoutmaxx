import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// env-check is NOT mocked by setup.ts — real implementation used.
// `checked` is module-level state; reset via vi.resetModules() before each test.

describe("envCheck", () => {
  let envCheck: () => void;

  // Saved originals from setup.ts
  const savedKey = process.env.SHOPIFY_API_KEY;
  const savedSecret = process.env.SHOPIFY_API_SECRET;
  const savedUrl = process.env.SHOPIFY_APP_URL;

  beforeEach(async () => {
    // Fresh module = checked flag reset to false
    vi.resetModules();
    const mod = await import("@/lib/env-check");
    envCheck = mod.envCheck;

    // Restore to known-good values (setup.ts defaults)
    process.env.SHOPIFY_API_KEY = savedKey;
    process.env.SHOPIFY_API_SECRET = savedSecret;
    process.env.SHOPIFY_APP_URL = savedUrl;

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SHOPIFY_API_KEY = savedKey;
    process.env.SHOPIFY_API_SECRET = savedSecret;
    process.env.SHOPIFY_APP_URL = savedUrl;
    vi.restoreAllMocks();
  });

  it("throws when SHOPIFY_API_KEY is missing", () => {
    delete process.env.SHOPIFY_API_KEY;
    expect(() => envCheck()).toThrow("SHOPIFY_API_KEY");
  });

  it("throws when SHOPIFY_API_SECRET is missing", () => {
    delete process.env.SHOPIFY_API_SECRET;
    expect(() => envCheck()).toThrow("SHOPIFY_API_SECRET");
  });

  it("throws when SHOPIFY_APP_URL is missing", () => {
    delete process.env.SHOPIFY_APP_URL;
    expect(() => envCheck()).toThrow("SHOPIFY_APP_URL");
  });

  it("throws listing all three when all set to build-placeholder", () => {
    process.env.SHOPIFY_API_KEY = "build-placeholder";
    process.env.SHOPIFY_API_SECRET = "build-placeholder";
    process.env.SHOPIFY_APP_URL = "build-placeholder";
    expect(() => envCheck()).toThrow(/SHOPIFY_API_KEY.*SHOPIFY_API_SECRET.*SHOPIFY_APP_URL/);
  });

  it("does not throw and logs identity when all vars are real values", () => {
    process.env.SHOPIFY_API_KEY = "abcd1234e33b";
    process.env.SHOPIFY_API_SECRET = "real-secret-xyz";
    process.env.SHOPIFY_APP_URL = "https://couponmaxx.vercel.app";

    expect(() => envCheck()).not.toThrow();
    expect(console.log).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(
      "[env] app=e33b url=https://couponmaxx.vercel.app"
    );
  });

  it("only logs once when called twice (checked flag guard)", async () => {
    process.env.SHOPIFY_API_KEY = "abcd1234e33b";
    process.env.SHOPIFY_API_SECRET = "real-secret-xyz";
    process.env.SHOPIFY_APP_URL = "https://couponmaxx.vercel.app";

    envCheck();
    envCheck(); // second call should be a no-op

    expect(console.log).toHaveBeenCalledOnce();
  });
});

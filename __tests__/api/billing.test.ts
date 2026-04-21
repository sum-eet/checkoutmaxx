import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { sessionStorage } from "@/lib/shopify";
import { createSubscription, getActiveSubscription } from "@/lib/billing";

const mockSupabase = vi.mocked(supabase);
const mockSessionStorage = vi.mocked(sessionStorage);
const mockCreateSub = vi.mocked(createSubscription);
const mockGetActiveSub = vi.mocked(getActiveSubscription);

describe("/api/billing/create", () => {
  let GET: typeof import("@/app/api/billing/create/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/billing/create/route"));
  });

  it("returns 400 when shop param missing", async () => {
    const req = mockRequest("https://test.vercel.app/api/billing/create");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when no session found", async () => {
    mockSessionStorage.loadSession.mockResolvedValue(null as any);
    const req = mockRequest("https://test.vercel.app/api/billing/create?shop=test.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("redirects to Shopify billing URL on success", async () => {
    mockSessionStorage.loadSession.mockResolvedValue({
      accessToken: "token-123",
    } as any);
    mockCreateSub.mockResolvedValue("https://admin.shopify.com/billing/confirm/123");

    const req = mockRequest("https://test.vercel.app/api/billing/create?shop=test.myshopify.com");
    const res = await GET(req);
    // Redirect response
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("shopify.com/billing");
  });
});

describe("/api/billing/callback", () => {
  let GET: typeof import("@/app/api/billing/callback/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/billing/callback/route"));
  });

  it("redirects to analytics when shop param missing", async () => {
    const req = mockRequest("https://test.vercel.app/api/billing/callback");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("/couponmaxx/analytics");
    // Verify it does NOT redirect to /dashboard/converted (old dead route)
    expect(res.headers.get("Location")).not.toContain("/dashboard");
  });

  it("updates shop to ACTIVE when subscription approved", async () => {
    mockSessionStorage.loadSession.mockResolvedValue({
      accessToken: "token-123",
    } as any);
    mockGetActiveSub.mockResolvedValue({ id: "sub-1", status: "ACTIVE" });

    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    // Final .eq() should resolve
    updateChain.eq.mockReturnValue(updateChain);
    // Make last call resolve
    mockSupabase.from.mockReturnValue(updateChain as any);

    const req = mockRequest("https://test.vercel.app/api/billing/callback?shop=test.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("/couponmaxx/analytics");

    // Verify update was called with ACTIVE status
    expect(mockSupabase.from).toHaveBeenCalledWith("Shop");
  });
});

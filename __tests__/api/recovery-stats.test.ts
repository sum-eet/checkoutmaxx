import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

const mockSupabase = vi.mocked(supabase);
const mockGetAuthenticatedShop = vi.mocked(getAuthenticatedShop);
const mockGetShop = vi.mocked(getShop);

describe("GET /api/couponmaxx/recovery/stats", () => {
  let GET: typeof import("@/app/api/couponmaxx/recovery/stats/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAuthenticatedShop.mockReturnValue("test-shop.myshopify.com");
    mockGetShop.mockResolvedValue({ id: "shop-1", shopDomain: "test-shop.myshopify.com" } as any);
    ({ GET } = await import("@/app/api/couponmaxx/recovery/stats/route"));
  });

  it("returns 401 when shop missing", async () => {
    mockGetAuthenticatedShop.mockReturnValue(null);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns empty stats when no recovery events", async () => {
    const eventChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { enabled: true }, error: null }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "RecoveryEvent") return eventChain as any;
      if (table === "MerchantRecoverySettings") return settingsChain as any;
      return eventChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.codesOffered).toBe(0);
    expect(body.codesUsed).toBe(0);
    expect(body.useRate).toBe(0);
    expect(body.revenueRecovered).toBe(0);
    expect(body.avgRevenuePerUse).toBe(0);
    expect(body.topTrigger).toBeNull();
  });

  it("computes stats correctly from recovery events", async () => {
    const eventChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({
        data: [
          { recoveryAction: "show_code", recoveryUsed: true, revenueRecovered: 5000, failureReason: "expired" },
          { recoveryAction: "show_code", recoveryUsed: false, revenueRecovered: null, failureReason: "expired" },
          { recoveryAction: "show_code", recoveryUsed: true, revenueRecovered: 3000, failureReason: "min_not_met" },
          { recoveryAction: "show_hint", recoveryUsed: false, revenueRecovered: null, failureReason: "invalid" },
        ],
        error: null,
      }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { enabled: true }, error: null }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "RecoveryEvent") return eventChain as any;
      return settingsChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats");
    const res = await GET(req);
    const body = await res.json();

    expect(body.codesOffered).toBe(3);
    expect(body.codesUsed).toBe(2);
    expect(body.useRate).toBe(66.7);
    expect(body.revenueRecovered).toBe(8000);
    expect(body.avgRevenuePerUse).toBe(4000);
    expect(body.topTrigger).toBe("expired");
  });
});

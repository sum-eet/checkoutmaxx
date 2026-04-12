import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);

describe("GET /api/couponmaxx/recovery/stats", () => {
  let GET: typeof import("@/app/api/couponmaxx/recovery/stats/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET } = await import("@/app/api/couponmaxx/recovery/stats/route"));
  });

  it("returns 400 when shop missing", async () => {
    mockGetShop.mockReturnValue(null as any);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns empty stats when no recovery events", async () => {
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
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
      if (table === "Shop") return shopChain as any;
      if (table === "RecoveryEvent") return eventChain as any;
      if (table === "MerchantRecoverySettings") return settingsChain as any;
      return eventChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats?shop=test-shop.myshopify.com");
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
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
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
      if (table === "Shop") return shopChain as any;
      if (table === "RecoveryEvent") return eventChain as any;
      return settingsChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/stats?shop=test-shop.myshopify.com");
    const res = await GET(req);
    const body = await res.json();

    expect(body.codesOffered).toBe(3); // 3 show_code events
    expect(body.codesUsed).toBe(2); // 2 with recoveryUsed=true
    expect(body.useRate).toBe(66.7); // 2/3
    expect(body.revenueRecovered).toBe(8000); // 5000 + 3000
    expect(body.avgRevenuePerUse).toBe(4000); // 8000 / 2
    expect(body.topTrigger).toBe("expired"); // 2 expired vs 1 each other
  });
});

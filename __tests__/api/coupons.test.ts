import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/ensure-shop";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);
const mockEnsureShop = vi.mocked(ensureShop);

describe("GET /api/couponmaxx/coupons", () => {
  let GET: typeof import("@/app/api/couponmaxx/coupons/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET } = await import("@/app/api/couponmaxx/coupons/route"));
  });

  it("returns 400 when shop is missing", async () => {
    mockEnsureShop.mockResolvedValueOnce(null);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns valid response shape with empty data", async () => {
    mockEnsureShop.mockResolvedValueOnce({ shopId: "shop-1", shopDomain: "test-shop.myshopify.com" });

    // Cart event queries return empty
    const emptyChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      return emptyChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons?shop=test-shop.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("truncated");
    expect(body).toHaveProperty("boxes");
    expect(body).toHaveProperty("codes");
    expect(body).toHaveProperty("zombieCodes");
    expect(body).toHaveProperty("velocityChart");
    expect(body).toHaveProperty("successRateChart");
    expect(body.truncated).toBe(false);
    expect(body.codes).toEqual([]);
    expect(body.zombieCodes).toEqual([]);
    expect(body.boxes.codesTracked).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);

describe("GET /api/couponmaxx/coupons", () => {
  let GET: typeof import("@/app/api/couponmaxx/coupons/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET } = await import("@/app/api/couponmaxx/coupons/route"));
  });

  it("returns 400 when shop is missing", async () => {
    mockGetShop.mockReturnValue(null as any);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when shop not found", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons?shop=unknown.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns valid response shape with empty data", async () => {
    // Shop lookup
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };

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

    let callCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "Shop") return shopChain as any;
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

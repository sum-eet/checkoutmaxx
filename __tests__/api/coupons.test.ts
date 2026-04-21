import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

const mockSupabase = vi.mocked(supabase);
const mockGetAuthenticatedShop = vi.mocked(getAuthenticatedShop);
const mockGetShop = vi.mocked(getShop);

describe("GET /api/couponmaxx/coupons", () => {
  let GET: typeof import("@/app/api/couponmaxx/coupons/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAuthenticatedShop.mockReturnValue("test-shop.myshopify.com");
    mockGetShop.mockResolvedValue({ id: "shop-1", shopDomain: "test-shop.myshopify.com" } as any);
    ({ GET } = await import("@/app/api/couponmaxx/coupons/route"));
  });

  it("returns 401 when shop is missing", async () => {
    mockGetAuthenticatedShop.mockReturnValue(null);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns valid response shape with empty data", async () => {
    const emptyChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockSupabase.from.mockImplementation((_table: string) => {
      return emptyChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/coupons");
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

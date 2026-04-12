import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

// Access mocked modules
import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);

describe("GET /api/couponmaxx/sessions", () => {
  let GET: typeof import("@/app/api/couponmaxx/sessions/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET } = await import("@/app/api/couponmaxx/sessions/route"));
  });

  it("returns 400 when shop is missing", async () => {
    mockGetShop.mockReturnValue(null as any);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing shop");
  });

  it("returns 404 when shop not found in DB", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions?shop=unknown.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns valid response shape with empty data", async () => {
    // Mock shop lookup
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
    mockSupabase.from.mockReturnValue(shopChain as any);

    // Mock RPC calls
    mockSupabase.rpc.mockResolvedValue({
      data: [{ carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 }],
      error: null,
    } as any);

    // Second RPC call returns empty session summaries
    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{ carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 }],
        error: null,
      } as any)
      .mockResolvedValueOnce({ data: [], error: null } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions?shop=test-shop.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("sessions");
    expect(body).toHaveProperty("boxes");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("perPage");
    expect(body).toHaveProperty("scopedBoxes");
    expect(body).toHaveProperty("scopedCounts");
    expect(body.sessions).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(25);
  });

  it("defaults to page 1 with 25 per page", async () => {
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
    mockSupabase.from.mockReturnValue(shopChain as any);
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [{ carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 }], error: null } as any)
      .mockResolvedValueOnce({ data: [], error: null } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions?shop=test-shop.myshopify.com");
    const res = await GET(req);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(25);
  });
});

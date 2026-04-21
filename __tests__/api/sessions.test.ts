import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

const mockSupabase = vi.mocked(supabase);
const mockGetAuthenticatedShop = vi.mocked(getAuthenticatedShop);
const mockGetShop = vi.mocked(getShop);

describe("GET /api/couponmaxx/sessions", () => {
  let GET: typeof import("@/app/api/couponmaxx/sessions/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAuthenticatedShop.mockReturnValue("test-shop.myshopify.com");
    mockGetShop.mockResolvedValue({ id: "shop-1", shopDomain: "test-shop.myshopify.com" } as any);
    ({ GET } = await import("@/app/api/couponmaxx/sessions/route"));
  });

  it("returns 401 when shop is missing", async () => {
    mockGetAuthenticatedShop.mockReturnValue(null);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns valid response shape with empty data", async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{ carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 }],
        error: null,
      } as any)
      .mockResolvedValueOnce({ data: [], error: null } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions");
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
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [{ carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 }], error: null } as any)
      .mockResolvedValueOnce({ data: [], error: null } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/sessions");
    const res = await GET(req);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(25);
  });
});

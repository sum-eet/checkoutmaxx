import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);

describe("GET /api/couponmaxx/notifications", () => {
  let GET: typeof import("@/app/api/couponmaxx/notifications/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET } = await import("@/app/api/couponmaxx/notifications/route"));
  });

  it("returns 400 when shop is missing", async () => {
    mockGetShop.mockReturnValue(null as any);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when shop not found", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications?shop=unknown.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns valid response with empty alerts", async () => {
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
    const alertChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "Shop") return shopChain as any;
      return alertChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications?shop=test-shop.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("alerts");
    expect(body.summary).toEqual({ unreadCount: 0, criticalCount: 0, warningCount: 0 });
    expect(body.alerts).toEqual([]);
  });

  it("returns alerts with correct severity counts", async () => {
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
    const alertChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: "a1", title: "Broken code", body: "SAVE10", severity: "critical", firedAt: "2026-04-12T00:00:00Z", isRead: false, isDismissed: false },
          { id: "a2", title: "CVR drop", body: null, severity: "warning", firedAt: "2026-04-11T00:00:00Z", isRead: true, isDismissed: false },
          { id: "a3", title: "New source", body: null, severity: "info", firedAt: "2026-04-10T00:00:00Z", isRead: false, isDismissed: true },
        ],
        error: null,
      }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "Shop") return shopChain as any;
      return alertChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications?shop=test-shop.myshopify.com");
    const res = await GET(req);
    const body = await res.json();

    expect(body.alerts).toHaveLength(3);
    expect(body.summary.unreadCount).toBe(1); // a1 unread+not dismissed
    expect(body.summary.criticalCount).toBe(1); // a1 critical+not dismissed
    expect(body.summary.warningCount).toBe(1); // a2 warning+not dismissed
  });

  it("falls back when isRead/isDismissed columns missing", async () => {
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };

    // First query fails (missing columns), fallback succeeds
    let queryCount = 0;
    const alertChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        queryCount++;
        if (queryCount === 1) {
          return Promise.resolve({ data: null, error: { message: "column isRead does not exist" } });
        }
        return Promise.resolve({
          data: [{ id: "a1", title: "Alert", severity: "warning", firedAt: "2026-04-12T00:00:00Z" }],
          error: null,
        });
      }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "Shop") return shopChain as any;
      return alertChain as any;
    });

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications?shop=test-shop.myshopify.com");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Without isRead/isDismissed, all default to false
    expect(body.alerts[0].isRead).toBe(false);
    expect(body.alerts[0].isDismissed).toBe(false);
  });
});

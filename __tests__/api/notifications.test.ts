import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

const mockSupabase = vi.mocked(supabase);
const mockGetAuthenticatedShop = vi.mocked(getAuthenticatedShop);
const mockGetShop = vi.mocked(getShop);

describe("GET /api/couponmaxx/notifications", () => {
  let GET: typeof import("@/app/api/couponmaxx/notifications/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAuthenticatedShop.mockReturnValue("test-shop.myshopify.com");
    mockGetShop.mockResolvedValue({ id: "shop-1", shopDomain: "test-shop.myshopify.com" } as any);
    ({ GET } = await import("@/app/api/couponmaxx/notifications/route"));
  });

  it("returns 401 when shop is missing", async () => {
    mockGetAuthenticatedShop.mockReturnValue(null);
    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns valid response with empty alerts", async () => {
    const alertChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockSupabase.from.mockReturnValue(alertChain as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("alerts");
    expect(body.summary).toEqual({ unreadCount: 0, criticalCount: 0, warningCount: 0 });
    expect(body.alerts).toEqual([]);
  });

  it("returns alerts with correct severity counts", async () => {
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

    mockSupabase.from.mockReturnValue(alertChain as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications");
    const res = await GET(req);
    const body = await res.json();

    expect(body.alerts).toHaveLength(3);
    expect(body.summary.unreadCount).toBe(1);
    expect(body.summary.criticalCount).toBe(1);
    expect(body.summary.warningCount).toBe(1);
  });

  it("falls back when isRead/isDismissed columns missing", async () => {
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

    mockSupabase.from.mockReturnValue(alertChain as any);

    const req = mockRequest("https://test.vercel.app/api/couponmaxx/notifications");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.alerts[0].isRead).toBe(false);
    expect(body.alerts[0].isDismissed).toBe(false);
  });
});

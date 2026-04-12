import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getShopFromRequest } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/ensure-shop";

const mockSupabase = vi.mocked(supabase);
const mockGetShop = vi.mocked(getShopFromRequest);
const mockEnsureShop = vi.mocked(ensureShop);

describe("/api/couponmaxx/recovery/settings", () => {
  let GET: typeof import("@/app/api/couponmaxx/recovery/settings/route").GET;
  let POST: typeof import("@/app/api/couponmaxx/recovery/settings/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetShop.mockReturnValue("test-shop.myshopify.com");
    ({ GET, POST } = await import("@/app/api/couponmaxx/recovery/settings/route"));
  });

  describe("GET", () => {
    it("returns 400 when shop missing", async () => {
      mockEnsureShop.mockResolvedValueOnce(null);
      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("returns null settings when no row exists", async () => {
      mockEnsureShop.mockResolvedValueOnce({ shopId: "shop-1", shopDomain: "test-shop.myshopify.com" });
      const settingsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabase.from.mockReturnValue(settingsChain as any);

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings?shop=test-shop.myshopify.com");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings).toBeNull();
    });

    it("returns settings with defaults applied", async () => {
      mockEnsureShop.mockResolvedValueOnce({ shopId: "shop-1", shopDomain: "test-shop.myshopify.com" });
      const settingsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { enabled: true, rules: null, hunterThreshold: null },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(settingsChain as any);

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings?shop=test-shop.myshopify.com");
      const res = await GET(req);
      const body = await res.json();
      expect(body.settings.enabled).toBe(true);
      expect(body.settings.hunterThreshold).toBe(3);
      expect(body.settings.rules).toBeDefined();
    });
  });

  describe("POST", () => {
    it("returns 400 when shop or settings missing", async () => {
      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings", {
        method: "POST",
        body: { shop: "test.myshopify.com" }, // missing settings
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("saves settings successfully", async () => {
      const shopChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
      };
      const upsertChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "Shop") return shopChain as any;
        return upsertChain as any;
      });

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings", {
        method: "POST",
        body: {
          shop: "test-shop.myshopify.com",
          settings: { enabled: true, hunterThreshold: 5 },
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });
});

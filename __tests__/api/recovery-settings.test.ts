import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "../helpers";

import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

const mockSupabase = vi.mocked(supabase);
const mockGetAuthenticatedShop = vi.mocked(getAuthenticatedShop);
const mockGetShop = vi.mocked(getShop);

describe("/api/couponmaxx/recovery/settings", () => {
  let GET: typeof import("@/app/api/couponmaxx/recovery/settings/route").GET;
  let POST: typeof import("@/app/api/couponmaxx/recovery/settings/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAuthenticatedShop.mockReturnValue("test-shop.myshopify.com");
    mockGetShop.mockResolvedValue({ id: "shop-1", shopDomain: "test-shop.myshopify.com" } as any);
    ({ GET, POST } = await import("@/app/api/couponmaxx/recovery/settings/route"));
  });

  describe("GET", () => {
    it("returns 401 when shop missing", async () => {
      mockGetAuthenticatedShop.mockReturnValue(null);
      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns null settings when no row exists", async () => {
      const settingsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabase.from.mockReturnValue(settingsChain as any);

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings).toBeNull();
    });

    it("returns settings with defaults applied", async () => {
      const settingsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { enabled: true, rules: null, hunterThreshold: null },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(settingsChain as any);

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings");
      const res = await GET(req);
      const body = await res.json();
      expect(body.settings.enabled).toBe(true);
      expect(body.settings.hunterThreshold).toBe(3);
      expect(body.settings.rules).toBeDefined();
    });
  });

  describe("POST", () => {
    it("returns 400 when settings missing", async () => {
      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings", {
        method: "POST",
        body: {}, // missing settings
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("saves settings successfully", async () => {
      const upsertChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from.mockReturnValue(upsertChain as any);

      const req = mockRequest("https://test.vercel.app/api/couponmaxx/recovery/settings", {
        method: "POST",
        body: {
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

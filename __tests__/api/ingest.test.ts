import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@/lib/supabase";

const mockSupabase = vi.mocked(supabase);

describe("/api/pixel/ingest", () => {
  let POST: typeof import("@/app/api/pixel/ingest/route").POST;
  let OPTIONS: typeof import("@/app/api/pixel/ingest/route").OPTIONS;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST, OPTIONS } = await import("@/app/api/pixel/ingest/route"));
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("https://test.vercel.app/api/pixel/ingest", {
      method: "POST",
      body: "not json {{{",
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 when required fields missing", async () => {
    const req = new Request("https://test.vercel.app/api/pixel/ingest", {
      method: "POST",
      body: JSON.stringify({ eventType: "checkout_started" }), // missing shopDomain
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("returns 200 with CORS for valid event", async () => {
    // Mock shop lookup for the background processEvent
    const shopChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "shop-1" }, error: null }),
    };
    const insertChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "Shop") return shopChain as any;
      return insertChain as any;
    });

    const req = new Request("https://test.vercel.app/api/pixel/ingest", {
      method: "POST",
      body: JSON.stringify({
        shopDomain: "test-shop.myshopify.com",
        eventType: "checkout_started",
        sessionId: "sess-123",
        occurredAt: new Date().toISOString(),
        deviceType: "desktop",
        country: "US",
        data: {},
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("/api/cart/ingest", () => {
  let POST: typeof import("@/app/api/cart/ingest/route").POST;
  let OPTIONS: typeof import("@/app/api/cart/ingest/route").OPTIONS;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST, OPTIONS } = await import("@/app/api/cart/ingest/route"));
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

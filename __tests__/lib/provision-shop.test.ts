import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@/lib/supabase";

// Imported after mocks are set up
let provisionShop: typeof import("@/lib/provision-shop").provisionShop;

const mockFrom = vi.mocked(supabase.from);

/**
 * Build a chainable Supabase mock for the deactivate+insert sequence.
 * deactivateResult: value returned when the update chain resolves
 * insertResult: value returned when the insert chain's .single() resolves
 */
function mockDeactivateThenInsert(
  deactivateResult: { error: any },
  insertResult: { data: any; error: any }
) {
  const insertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(insertResult),
  };
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(deactivateResult),
  };
  const insertChainRoot = {
    insert: vi.fn().mockReturnValue(insertChain),
  };

  // First call to .from() → deactivate (update chain)
  // Second call to .from() → insert chain
  mockFrom
    .mockReturnValueOnce(updateChain as any)
    .mockReturnValueOnce(insertChainRoot as any);
}

/**
 * Mock for race re-query (the select after a 23505).
 * Called as the third .from() in the race scenario.
 * Ends with .order() — returns a resolved Promise directly (no .maybeSingle()).
 */
function mockRaceRequery(result: { data: any; error: any }) {
  const raceChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  };
  mockFrom.mockReturnValueOnce(raceChain as any);
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-import to get fresh module state (checked flag in env-check, etc.)
  const mod = await import("@/lib/provision-shop");
  provisionShop = mod.provisionShop;
});

describe("provisionShop", () => {
  it("happy path — creates fresh shop row", async () => {
    mockDeactivateThenInsert(
      { error: null },
      { data: { id: "new-uuid-123" }, error: null }
    );

    const result = await provisionShop("test.myshopify.com", "shpat_abc123");

    expect(result).toEqual({ shopId: "new-uuid-123" });
  });

  it("deactivate failure is non-fatal — still creates row", async () => {
    mockDeactivateThenInsert(
      { error: { message: "connection timeout" } },
      { data: { id: "new-uuid-456" }, error: null }
    );

    const result = await provisionShop("test.myshopify.com", "shpat_abc123");

    expect(result).toEqual({ shopId: "new-uuid-456" });
  });

  it("race condition (23505) — re-query finds winner with boolean isActive", async () => {
    mockDeactivateThenInsert(
      { error: null },
      { data: null, error: { code: "23505", message: "unique_violation" } }
    );
    mockRaceRequery({
      data: [
        { id: "old-inactive", isActive: false },
        { id: "winner-uuid", isActive: true },
      ],
      error: null,
    });

    const result = await provisionShop("test.myshopify.com", "shpat_abc123");

    expect(result).toEqual({ shopId: "winner-uuid" });
  });

  it("race condition — JS filter handles stringified isActive='true'", async () => {
    mockDeactivateThenInsert(
      { error: null },
      { data: null, error: { code: "23505", message: "unique_violation" } }
    );
    // Simulates PostgREST boolean coercion bug: isActive comes back as string "true"
    mockRaceRequery({
      data: [{ id: "winner-uuid", isActive: "true" }],
      error: null,
    });

    const result = await provisionShop("test.myshopify.com", "shpat_abc123");

    expect(result).toEqual({ shopId: "winner-uuid" });
  });

  it("fatal insert failure (non-23505) — throws", async () => {
    mockDeactivateThenInsert(
      { error: null },
      { data: null, error: { code: "42501", message: "permission denied for table Shop" } }
    );

    await expect(
      provisionShop("test.myshopify.com", "shpat_abc123")
    ).rejects.toThrow("INSERT FAILED");
  });

  it("race re-query itself fails — throws", async () => {
    mockDeactivateThenInsert(
      { error: null },
      { data: null, error: { code: "23505", message: "unique_violation" } }
    );
    mockRaceRequery({ data: null, error: { message: "db unavailable" } });

    await expect(
      provisionShop("test.myshopify.com", "shpat_abc123")
    ).rejects.toThrow("race re-query failed");
  });
});

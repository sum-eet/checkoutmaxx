import { vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Create a mock NextRequest for testing API routes.
 */
export function mockRequest(
  url: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const { method = "GET", body, headers = {} } = options ?? {};
  const init: RequestInit & { signal?: AbortSignal } = { method, headers };
  if (body) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!headers["Content-Type"]) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }
  return new NextRequest(new URL(url, "https://test.vercel.app"), init as any);
}

/**
 * Build a chainable Supabase mock that resolves with given data.
 * Usage: mockSupabaseChain({ data: [...], error: null })
 */
export function mockSupabaseChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "gte", "lte", "in", "not", "is", "or",
    "order", "limit",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // For queries without .single()
  (chain as any).then = undefined; // make it not look like a promise
  // Override the last chained method to return the result
  return { ...chain, __result: result };
}

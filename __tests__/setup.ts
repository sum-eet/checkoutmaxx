// Global test setup — mock external dependencies

import { vi } from "vitest";

// Mock Supabase client
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

// Mock verify-session-token
vi.mock("@/lib/verify-session-token", () => ({
  getShopFromRequest: vi.fn().mockReturnValue("test-shop.myshopify.com"),
  getSessionTokenFromRequest: vi.fn().mockReturnValue("mock-token"),
}));

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    checkoutEvent: { create: vi.fn() },
    cartEvent: { create: vi.fn() },
    alertLog: { findMany: vi.fn(), update: vi.fn() },
  },
}));

// Mock waitUntil
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => p),
}));

// Mock Shopify API
vi.mock("@/lib/shopify", () => ({
  shopify: {
    session: { getOfflineId: vi.fn((shop: string) => `offline_${shop}`) },
    clients: {
      Graphql: vi.fn().mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ body: { data: {} } }),
        request: vi.fn().mockResolvedValue({ data: {} }),
      })),
      Rest: vi.fn().mockImplementation(() => ({
        post: vi.fn(),
        get: vi.fn(),
      })),
    },
    utils: { sanitizeShop: vi.fn((s: string) => s) },
    auth: { begin: vi.fn(), tokenExchange: vi.fn() },
  },
  sessionStorage: {
    loadSession: vi.fn(),
    storeSession: vi.fn(),
    deleteSession: vi.fn(),
  },
  registerWebhooks: vi.fn(),
}));

// Mock ensure-shop — returns a valid shop by default
vi.mock("@/lib/ensure-shop", () => ({
  ensureShop: vi.fn().mockResolvedValue({ shopId: "shop-1", shopDomain: "test-shop.myshopify.com" }),
}));

// Mock session-utils
vi.mock("@/lib/session-utils", () => ({
  buildSessionsFromEvents: vi.fn().mockReturnValue([]),
  deriveSourceV3: vi.fn().mockReturnValue("Direct"),
}));

// Mock billing
vi.mock("@/lib/billing", () => ({
  PRO_PLAN: { name: "Pro", price: 49, currencyCode: "USD", interval: "EVERY_30_DAYS", trialDays: 7 },
  createSubscription: vi.fn().mockResolvedValue("https://shopify.com/billing/confirm"),
  getActiveSubscription: vi.fn().mockResolvedValue(null),
}));

// Mock ingest-log
vi.mock("@/lib/ingest-log", () => ({
  logIngest: vi.fn(),
}));

// Mock sanitize (real implementation for sanitize tests, mock for others)
// Sanitize tests will use vi.unmock

// Env vars
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://test.vercel.app";
process.env.NEXT_PUBLIC_APP_URL = "https://test.vercel.app";
process.env.CRON_SECRET = "test-cron-secret";

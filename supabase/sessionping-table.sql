CREATE TABLE IF NOT EXISTS "SessionPing" (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "sessionId" text NOT NULL,
  source text NOT NULL,        -- 'cart' or 'checkout'
  "shopDomain" text NOT NULL,
  country text,
  device text,
  "pageUrl" text,
  "occurredAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SessionPing_shopDomain_occurredAt_idx"
  ON "SessionPing" ("shopDomain", "occurredAt" DESC);

CREATE INDEX IF NOT EXISTS "SessionPing_sessionId_idx"
  ON "SessionPing" ("sessionId");

CREATE INDEX IF NOT EXISTS "SessionPing_source_occurredAt_idx"
  ON "SessionPing" (source, "occurredAt" DESC);

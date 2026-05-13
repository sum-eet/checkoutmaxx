-- Add shippingPrice column to CheckoutEvent
ALTER TABLE "CheckoutEvent" ADD COLUMN IF NOT EXISTS "shippingPrice" DOUBLE PRECISION;

-- Add composite unique index for upsert support (synthesized checkout_started)
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutEvent_shopId_sessionId_eventType_key"
  ON "CheckoutEvent" ("shopId", "sessionId", "eventType");

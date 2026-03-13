import { supabase } from "./supabase";

/**
 * Write one row to IngestLog after every ingest attempt.
 * Fire-and-forget — never awaited, never blocks the response.
 */
export function logIngest({
  endpoint,
  shopDomain,
  eventType,
  success,
  latencyMs,
  errorCode,
  errorMessage,
}: {
  endpoint: "cart" | "pixel";
  shopDomain: string;
  eventType?: string | null;
  success: boolean;
  latencyMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}): void {
  supabase
    .from("IngestLog")
    .insert({
      endpoint,
      shopDomain,
      eventType: eventType ?? null,
      success,
      latencyMs,
      errorCode: errorCode ?? null,
      errorMessage: errorMessage ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[IngestLog] write failed:", error.message);
    });
}

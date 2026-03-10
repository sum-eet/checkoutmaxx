/**
 * Strip PII fields from pixel event payloads before DB storage.
 * Guardrail #3: No raw PII in CheckoutEvent.rawPayload
 */
export function sanitizePayload(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};

  const PII_KEYS = [
    "email",
    "phone",
    "firstName",
    "first_name",
    "lastName",
    "last_name",
    "name",
    "cardNumber",
    "card_number",
    "cvv",
    "creditCard",
    "credit_card",
    "billingAddress",
    "billing_address",
  ];

  function scrub(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(scrub);
    }
    if (obj && typeof obj === "object") {
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (PII_KEYS.includes(key)) {
          cleaned[key] = "[redacted]";
        } else {
          cleaned[key] = scrub(value);
        }
      }
      return cleaned;
    }
    return obj;
  }

  return scrub(data) as Record<string, unknown>;
}

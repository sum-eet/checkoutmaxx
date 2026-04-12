import { describe, it, expect, vi } from "vitest";

// Use real implementation for this test
vi.unmock("@/lib/sanitize");
import { sanitizePayload } from "@/lib/sanitize";

describe("sanitizePayload", () => {
  it("strips email fields", () => {
    const result = sanitizePayload({ email: "user@example.com", shopId: "abc" });
    expect(result.email).toBe("[redacted]");
    expect(result.shopId).toBe("abc");
  });

  it("strips phone fields", () => {
    const result = sanitizePayload({ phone: "+15551234567" });
    expect(result.phone).toBe("[redacted]");
  });

  it("strips name fields", () => {
    const result = sanitizePayload({
      firstName: "John",
      lastName: "Doe",
      name: "John Doe",
      first_name: "John",
      last_name: "Doe",
    });
    expect(result.firstName).toBe("[redacted]");
    expect(result.lastName).toBe("[redacted]");
    expect(result.name).toBe("[redacted]");
    expect(result.first_name).toBe("[redacted]");
    expect(result.last_name).toBe("[redacted]");
  });

  it("strips credit card fields", () => {
    const result = sanitizePayload({
      cardNumber: "4111111111111111",
      cvv: "123",
      creditCard: "4111",
      card_number: "4111",
      credit_card: "4111",
    });
    expect(result.cardNumber).toBe("[redacted]");
    expect(result.cvv).toBe("[redacted]");
    expect(result.creditCard).toBe("[redacted]");
    expect(result.card_number).toBe("[redacted]");
    expect(result.credit_card).toBe("[redacted]");
  });

  it("strips billing address", () => {
    const result = sanitizePayload({
      billingAddress: { street: "123 Main" },
      billing_address: { street: "123 Main" },
    });
    expect(result.billingAddress).toBe("[redacted]");
    expect(result.billing_address).toBe("[redacted]");
  });

  it("preserves non-PII fields", () => {
    const result = sanitizePayload({
      eventType: "checkout_completed",
      totalPrice: 99.99,
      currency: "USD",
      discountCodes: ["SAVE10"],
    });
    expect(result.eventType).toBe("checkout_completed");
    expect(result.totalPrice).toBe(99.99);
    expect(result.currency).toBe("USD");
    expect(result.discountCodes).toEqual(["SAVE10"]);
  });

  it("handles nested objects", () => {
    const result = sanitizePayload({
      customer: { email: "a@b.com", id: "123" },
    });
    const customer = result.customer as Record<string, unknown>;
    expect(customer.email).toBe("[redacted]");
    expect(customer.id).toBe("123");
  });

  it("handles arrays with objects", () => {
    const result = sanitizePayload({
      items: [
        { name: "John", productId: "p1" },
        { name: "Jane", productId: "p2" },
      ],
    });
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0].name).toBe("[redacted]");
    expect(items[0].productId).toBe("p1");
    expect(items[1].name).toBe("[redacted]");
  });

  it("handles null/undefined input", () => {
    expect(sanitizePayload(null as any)).toEqual({});
    expect(sanitizePayload(undefined as any)).toEqual({});
  });

  it("handles empty object", () => {
    expect(sanitizePayload({})).toEqual({});
  });
});

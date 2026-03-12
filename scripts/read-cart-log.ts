// scripts/read-cart-log.ts
// Run with: npx ts-node scripts/read-cart-log.ts
// Or: npx ts-node scripts/read-cart-log.ts --type cart_coupon_failed
// Or: npx ts-node scripts/read-cart-log.ts --summary

import { readFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join("/tmp", "cart-events.log");
const filterType = process.argv.includes("--type")
  ? process.argv[process.argv.indexOf("--type") + 1]
  : null;
const summaryMode = process.argv.includes("--summary");

let lines: any[] = [];
try {
  const raw = readFileSync(LOG_FILE, "utf-8");
  lines = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
} catch {
  console.log("No log file found at", LOG_FILE);
  console.log("Make sure you ran: npx shopify app dev");
  console.log("And performed cart interactions on the store.");
  process.exit(0);
}

if (summaryMode) {
  const counts: Record<string, number> = {};
  for (const e of lines) {
    counts[e.eventType] = (counts[e.eventType] || 0) + 1;
  }
  console.log("\n── Cart Event Summary ──────────────────────");
  for (const [type, count] of Object.entries(counts).sort(
    (a, b) => (b[1] as number) - (a[1] as number)
  )) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }
  console.log(`\nTotal events: ${lines.length}`);
  console.log("────────────────────────────────────────────\n");
  process.exit(0);
}

const filtered = filterType ? lines.filter((e) => e.eventType === filterType) : lines;

console.log(`\n── Cart Events (${filtered.length}) ─────────────────────\n`);
for (const event of filtered) {
  console.log(`[${event.receivedAt}] ${event.eventType}`);
  console.log(`  Session:    ${event.sessionId}`);
  console.log(`  Cart token: ${event.cartToken}`);
  console.log(`  Payload:`, JSON.stringify(event.payload, null, 4));
  console.log("");
}

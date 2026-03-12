import prisma from "../lib/prisma";

const shopId = "cmmmbfwm90000m5x655lmb3h5";
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

const steps = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_address_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
];

async function main() {
  for (const et of steps) {
    const rows = await prisma.checkoutEvent.findMany({
      where: { shopId, eventType: et, occurredAt: { gte: since } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    });
    console.log(`${et}: ${rows.length}`);
    rows.forEach((r: any) => console.log("  -", r.sessionId));
  }

  const completed = await prisma.checkoutEvent.findMany({
    where: { shopId, eventType: "checkout_completed", occurredAt: { gte: since } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  const payment = await prisma.checkoutEvent.findMany({
    where: { shopId, eventType: "payment_info_submitted", occurredAt: { gte: since } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });

  const paymentSet = new Set(payment.map((r: any) => r.sessionId));
  const noPayment = completed.filter((r: any) => !paymentSet.has(r.sessionId));
  console.log(`\nCompleted WITHOUT payment_info_submitted: ${noPayment.length}`);
  noPayment.forEach((r: any) => console.log("  -", r.sessionId));
  await prisma.$disconnect();
}

main().catch(console.error);

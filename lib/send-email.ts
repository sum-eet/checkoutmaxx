import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "CheckoutMaxx Alerts <alerts@flowymails.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

export async function sendAlertEmail({
  to,
  title,
  body,
  actionUrl,
  actionLabel,
  shopDomain,
}: {
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
  shopDomain: string;
}) {
  if (!process.env.RESEND_API_KEY || !to) return;

  const lines = [
    body,
    "",
    actionUrl && actionLabel ? `→ ${actionLabel}:\n${actionUrl}` : null,
    "",
    `View your dashboard: ${APP_URL}/dashboard?shop=${shopDomain}`,
    "",
    "— CheckoutMaxx",
  ].filter((l) => l !== null);

  await resend.emails.send({
    from: FROM,
    to,
    subject: `⚠️ ${title}`,
    text: lines.join("\n"),
  });
}

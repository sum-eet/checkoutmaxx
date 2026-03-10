const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

export async function sendSlackMessage({
  webhookUrl,
  title,
  body,
  actionUrl,
  actionLabel,
  shopDomain,
}: {
  webhookUrl: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
  shopDomain: string;
}) {
  if (!webhookUrl) return;

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*⚠️ ${title}*\n\n${body}` },
    },
  ];

  const actions: unknown[] = [];
  if (actionUrl && actionLabel) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: actionLabel },
      url: actionUrl,
      style: "danger",
    });
  }
  if (APP_URL) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "View Dashboard" },
      url: `${APP_URL}/dashboard?shop=${shopDomain}`,
    });
  }
  if (actions.length > 0) {
    blocks.push({ type: "actions", elements: actions });
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status}`);
  }
}

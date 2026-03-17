import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a Shopify webhook request.
 *
 * Reads the raw body from the request, computes HMAC-SHA256 using the
 * SHOPIFY_API_SECRET, and compares it to the X-Shopify-Hmac-Sha256 header.
 *
 * Returns the parsed body if valid, or null if the signature is missing/invalid.
 * Callers must return HTTP 401 on null.
 */
export async function verifyWebhookHmac(req: Request): Promise<{ body: unknown } | null> {
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  if (!hmacHeader) return null;

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;

  const rawBody = await req.text();

  const digest = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  // Use timing-safe comparison to prevent timing attacks
  const digestBuf = Buffer.from(digest);
  const headerBuf = Buffer.from(hmacHeader);
  if (digestBuf.length !== headerBuf.length || !timingSafeEqual(digestBuf, headerBuf)) {
    return null;
  }

  try {
    return { body: JSON.parse(rawBody) };
  } catch {
    return null;
  }
}

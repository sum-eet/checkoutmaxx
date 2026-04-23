// Shopify Managed Install: swap a session-token JWT for an offline access token.
// Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
export async function exchangeTokenForOffline(
  shopDomain: string,
  sessionToken: string
): Promise<string> {
  console.log('[token-exchange] shop=%s', shopDomain);
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[token-exchange] FAIL', res.status, body);
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    console.error('[token-exchange] no access_token in response', json);
    throw new Error('token exchange: no access_token');
  }
  console.log('[token-exchange] ok shop=%s scope=%s', shopDomain, json.scope);
  return json.access_token as string;
}

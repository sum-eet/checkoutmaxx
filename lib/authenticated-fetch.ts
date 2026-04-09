/**
 * Fetch wrapper that forwards the App Bridge session token (id_token)
 * from the page URL to API requests. This is needed because App Bridge 4.x
 * injects id_token into the iframe URL, but plain fetch() doesn't forward it.
 *
 * The id_token is required by ensureShop() for token exchange on first load.
 */
export function authenticatedFetcher(url: string): Promise<any> {
  const enrichedUrl = appendIdToken(url);
  return fetch(enrichedUrl).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

function appendIdToken(url: string): string {
  if (typeof window === "undefined") return url;

  // Get id_token from current page URL (App Bridge injects it)
  const pageParams = new URLSearchParams(window.location.search);
  const idToken = pageParams.get("id_token");
  if (!idToken) return url;

  // Don't add if already present
  const parsed = new URL(url, window.location.origin);
  if (parsed.searchParams.has("id_token")) return url;

  parsed.searchParams.set("id_token", idToken);
  return parsed.pathname + "?" + parsed.searchParams.toString();
}

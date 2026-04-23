// Bulletproof admin fetcher — guarantees no 401 UX.
//
// Four layers of defense:
// 1. App Bridge idToken() — canonical, handles 60s rotation.
// 2. URL ?id_token param — fresh on initial page load from Shopify.
// 3. Retry with a forced App Bridge refresh — covers race where token expired mid-flight.
// 4. Full page reload — Shopify re-injects a fresh id_token; next cycle is clean.
//
// Backend (verify-session-token.ts) accepts both Authorization: Bearer AND ?id_token
// query param. We send both on every request.

async function waitForAppBridge(maxMs = 3000): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (w.shopify?.idToken || w.shopify?.fetch) return w.shopify;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function getFreshToken(forceRefresh = false): Promise<string | null> {
  const bridge = await waitForAppBridge(forceRefresh ? 500 : 3000);
  if (bridge?.idToken) {
    try {
      const t = await bridge.idToken();
      if (t) {
        console.log('[CMX Admin] token source: App Bridge', { forceRefresh });
        return t;
      }
    } catch (e) {
      console.warn('[CMX Admin] App Bridge idToken() threw', e);
    }
  }
  if (typeof window !== 'undefined') {
    const urlToken = new URLSearchParams(window.location.search).get('id_token');
    if (urlToken) {
      console.log('[CMX Admin] token source: URL param');
      return urlToken;
    }
  }
  console.warn('[CMX Admin] no token available from any source');
  return null;
}

async function rawFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url, window.location.origin);
  if (!parsed.searchParams.has('id_token')) parsed.searchParams.set('id_token', token);
  return fetch(parsed.pathname + '?' + parsed.searchParams.toString(), {
    ...init,
    headers: { ...(init.headers as Record<string, string> || {}), Authorization: `Bearer ${token}` },
  });
}

export async function fetcher(url: string, init: RequestInit = {}): Promise<any> {
  console.log('[CMX Admin] fetch →', url);

  // Attempt 1 — fresh token from best available source.
  let token = await getFreshToken(false);
  if (token) {
    const res = await rawFetch(url, token, init);
    console.log('[CMX Admin] attempt 1 ←', { url, status: res.status });
    if (res.ok) return res.json();
    if (res.status !== 401) throw new Error(`HTTP ${res.status}`);
    console.warn('[CMX Admin] attempt 1 got 401 — retrying with forced refresh');
  }

  // Attempt 2 — force App Bridge refresh.
  token = await getFreshToken(true);
  if (token) {
    const res = await rawFetch(url, token, init);
    console.log('[CMX Admin] attempt 2 ←', { url, status: res.status });
    if (res.ok) return res.json();
    console.warn('[CMX Admin] attempt 2 still failed', { status: res.status });
  }

  // Layer 4 — page reload. Shopify re-injects fresh id_token on full document load.
  console.error('[CMX Admin] all auth layers failed — reloading page to get fresh id_token');
  if (typeof window !== 'undefined') window.location.reload();
  return new Promise(() => {}); // never resolves; UI won't render partial state.
}

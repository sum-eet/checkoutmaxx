import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const version = process.env.DASHBOARD_VERSION ?? 'v1';
  const { pathname, search } = request.nextUrl;

  // Preserve query params (shop, host, etc.) when redirecting
  function redirect(path: string) {
    return NextResponse.redirect(new URL(path + search, request.url));
  }

  // Root dashboard — redirect to version home
  if (pathname === '/dashboard') {
    const dest =
      version === 'v4' ? '/couponmaxx/analytics' :
      version === 'v3' ? '/dashboard/v3/overview' :
      version === 'v2' ? '/dashboard/v2/overview' :
      '/dashboard/cart';
    return redirect(dest);
  }

  // V1 routes accessed while version is v2/v3/v4 — redirect to version home
  const v1Routes = ['/dashboard/cart', '/dashboard/converted', '/dashboard/abandoned'];
  if ((version === 'v2' || version === 'v3' || version === 'v4') && v1Routes.includes(pathname)) {
    const dest =
      version === 'v4' ? '/couponmaxx/analytics' :
      version === 'v3' ? '/dashboard/v3/overview' :
      '/dashboard/v2/overview';
    return redirect(dest);
  }
}

export const config = {
  matcher: ['/dashboard', '/dashboard/cart', '/dashboard/converted', '/dashboard/abandoned'],
};

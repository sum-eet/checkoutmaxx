import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const version = process.env.DASHBOARD_VERSION ?? 'v1';
  const { pathname } = request.nextUrl;

  // Root dashboard — redirect to version home
  if (pathname === '/dashboard') {
    const dest =
      version === 'v3' ? '/dashboard/v3/overview' :
      version === 'v2' ? '/dashboard/v2/overview' :
      '/dashboard/cart';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // V1 routes accessed while version is v2/v3 — redirect to version home
  const v1Routes = ['/dashboard/cart', '/dashboard/converted', '/dashboard/abandoned'];
  if ((version === 'v2' || version === 'v3') && v1Routes.includes(pathname)) {
    const dest = version === 'v3' ? '/dashboard/v3/overview' : '/dashboard/v2/overview';
    return NextResponse.redirect(new URL(dest, request.url));
  }
}

export const config = {
  matcher: ['/dashboard', '/dashboard/cart', '/dashboard/converted', '/dashboard/abandoned'],
};

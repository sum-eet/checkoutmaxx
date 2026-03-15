import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const dashboard = process.env.DASHBOARD_VERSION ?? 'v1';
  if (request.nextUrl.pathname === '/dashboard') {
    return NextResponse.redirect(
      new URL(
        `/dashboard/${dashboard === 'v1' ? '' : dashboard + '/'}overview`,
        request.url,
      ),
    );
  }
}

export const config = {
  matcher: ['/dashboard'],
};

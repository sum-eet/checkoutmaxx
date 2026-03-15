import { redirect } from 'next/navigation';

export default function DashboardRedirect() {
  const version = process.env.DASHBOARD_VERSION ?? 'v1';
  if (version === 'v3') redirect('/dashboard/v3/overview');
  if (version === 'v2') redirect('/dashboard/v2/overview');
  redirect('/dashboard/cart');
}

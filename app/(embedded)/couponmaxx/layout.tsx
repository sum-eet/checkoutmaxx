'use client';

import { Tabs } from '@shopify/polaris';
import { usePathname, useRouter } from 'next/navigation';

const TABS = [
  { id: 'diagnostics', label: 'Diagnostics', href: '/couponmaxx/diagnostics' },
  { id: 'sessions',    label: 'Sessions',    href: '/couponmaxx/sessions' },
  { id: 'discounts',   label: 'Discounts',   href: '/couponmaxx/discounts' },
];

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = Math.max(0, TABS.findIndex(t => pathname?.startsWith(t.href)));

  function handleSelect(i: number) {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.push(TABS[i].href + search);
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <Tabs
            tabs={TABS.map(t => ({
              id: t.id,
              content: t.label,
              accessibilityLabel: t.label,
              panelID: `p-${t.id}`,
            }))}
            selected={selected}
            onSelect={handleSelect}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

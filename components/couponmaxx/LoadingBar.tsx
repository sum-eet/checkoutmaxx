'use client';

export function LoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 200,
      background: 'var(--p-color-bg-surface-secondary)',
    }}>
      <div style={{
        height: '100%',
        background: 'var(--p-color-bg-fill-info)',
        animation: 'loadOnce 1.5s ease-out forwards',
      }} />
      <style>{`
        @keyframes loadOnce {
          0% { width: 0%; }
          20% { width: 30%; }
          50% { width: 60%; }
          80% { width: 85%; }
          100% { width: 95%; }
        }
      `}</style>
    </div>
  );
}

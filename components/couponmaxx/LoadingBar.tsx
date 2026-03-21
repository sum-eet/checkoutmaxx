export function LoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 200, overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        background: 'var(--p-color-bg-fill-info)',
        animation: 'loadingSlide 1.2s ease-in-out infinite',
        width: '30%',
      }} />
      <style>{`@keyframes loadingSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
    </div>
  );
}

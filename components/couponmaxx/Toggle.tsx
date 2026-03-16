'use client';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <>
      <style>{`
        @keyframes cmTogglePulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer',
          background: checked ? '#0EA5E9' : '#E5E7EB',
          position: 'relative', transition: 'background 0.2s', padding: 0, flexShrink: 0,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </button>
    </>
  );
}

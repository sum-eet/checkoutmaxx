'use client';

interface ToggleGroupProps {
  options: string[];
  active: string;
  onChange: (option: string) => void;
}

export function ToggleGroup({ options, active, onChange }: ToggleGroupProps) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map((opt) => {
        const isActive = opt === active;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '5px 12px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              borderRadius: 6,
              border: isActive ? 'none' : '1px solid #E3E3E3',
              background: isActive ? '#0EA5E9' : 'transparent',
              color: isActive ? '#fff' : '#6B7280',
              cursor: 'pointer',
              transition: 'all 0.1s ease',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

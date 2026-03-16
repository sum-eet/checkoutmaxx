'use client';

type KpiBoxProps = {
  label: string;
  value: string | number;
  sub1?: string;
  sub2?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export function KpiBox({ label, value, sub1, sub2, active, onClick }: KpiBoxProps) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? '#F0F9FF' : '#FFFFFF',
        border: active ? '1.5px solid #0EA5E9' : '1px solid #E3E3E3',
        borderRadius: 8,
        padding: 16,
        cursor: onClick ? 'pointer' : undefined,
        minWidth: 130,
      }}
    >
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>{value}</div>
      {sub1 && <div style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>{sub1}</div>}
      {sub2 && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{sub2}</div>}
    </div>
  );
}

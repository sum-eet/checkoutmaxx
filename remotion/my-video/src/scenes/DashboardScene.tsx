import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

// Shopify Polaris color tokens
const P = {
  surface: "#f6f6f7",
  surfaceDefault: "#ffffff",
  textPrimary: "#202223",
  textSubdued: "#6d7175",
  textSuccess: "#008060",
  textCritical: "#d72c0d",
  textWarning: "#b98900",
  bgSuccess: "#aee9d1",
  bgCritical: "#fed3d1",
  bgWarning: "#ffea8a",
  bgSuccessSubdued: "#f1f8f5",
  bgCriticalSubdued: "#fff4f4",
  bgWarningSubdued: "#fdf8ec",
  border: "#e1e3e5",
  borderSubdued: "#edeeef",
  topBar: "#1a1a1a",
  iconSubdued: "#8c9196",
  shadow: "0 1px 2px 0 rgba(26,26,67,0.08), 0 0 0 1px rgba(26,26,67,0.04)",
  shadowMd: "0 3px 6px -3px rgba(26,26,67,0.08), 0 0 0 1px rgba(26,26,67,0.04)",
};

const PolarisBadge: React.FC<{
  status: "critical" | "warning" | "success";
  children: React.ReactNode;
}> = ({ status, children }) => {
  const colors = {
    critical: { bg: P.bgCritical, text: P.textCritical },
    warning: { bg: P.bgWarning, text: P.textWarning },
    success: { bg: P.bgSuccess, text: P.textSuccess },
  };
  const c = colors[status];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        color: c.text,
        background: c.bg,
        padding: "2px 10px",
        borderRadius: 10,
        lineHeight: "20px",
      }}
    >
      {children}
    </span>
  );
};

const PolarisKPI: React.FC<{
  label: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  delay: number;
}> = ({ label, value, trend, trendUp, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14 } });

  return (
    <div
      style={{
        flex: 1,
        background: P.surfaceDefault,
        borderRadius: 12,
        padding: "18px 20px",
        boxShadow: P.shadow,
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [12, 0])}px)`,
      }}
    >
      <div style={{ fontSize: 13, color: P.textSubdued, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: P.textPrimary, marginTop: 6 }}>
        {value}
      </div>
      {trend && (
        <div
          style={{
            fontSize: 12,
            color: trendUp ? P.textSuccess : P.textCritical,
            marginTop: 4,
            fontWeight: 500,
          }}
        >
          {trendUp ? "\u2191" : "\u2193"} {trend}
        </div>
      )}
    </div>
  );
};

const CouponRow: React.FC<{
  code: string;
  status: "critical" | "warning" | "success";
  statusLabel: string;
  attempts: number;
  successRate: number;
  avgCart: string;
  recoveries: number;
  delay: number;
}> = ({ code, status, statusLabel, attempts, successRate, avgCart, recoveries, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15 } });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 20px",
        borderBottom: `1px solid ${P.borderSubdued}`,
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [-15, 0])}px)`,
        background: P.surfaceDefault,
      }}
    >
      <div style={{ flex: 2, fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 13, fontWeight: 600, color: P.textPrimary, letterSpacing: 0.3 }}>
        {code}
      </div>
      <div style={{ flex: 1 }}>
        <PolarisBadge status={status}>{statusLabel}</PolarisBadge>
      </div>
      <div style={{ flex: 1, fontSize: 13, color: P.textSubdued, textAlign: "center" }}>
        {attempts}
      </div>
      <div style={{ flex: 1, fontSize: 13, textAlign: "center" }}>
        <span
          style={{
            color:
              successRate >= 70
                ? P.textSuccess
                : successRate >= 40
                ? P.textWarning
                : P.textCritical,
            fontWeight: 600,
          }}
        >
          {successRate}%
        </span>
      </div>
      <div style={{ flex: 1, fontSize: 13, color: P.textSubdued, textAlign: "center" }}>
        {avgCart}
      </div>
      <div style={{ flex: 1, fontSize: 13, textAlign: "center" }}>
        {recoveries > 0 ? (
          <span style={{ color: P.textSuccess, fontWeight: 600 }}>{recoveries}</span>
        ) : (
          <span style={{ color: P.iconSubdued }}>&mdash;</span>
        )}
      </div>
    </div>
  );
};

export const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 18 } });

  // Animate Revenue at Risk counter
  const riskStart = 40;
  const riskProgress = frame >= riskStart ? Math.min(1, (frame - riskStart) / 30) : 0;
  const riskValue = Math.floor(riskProgress * 4280);

  // Pulsing highlight on broken rows
  const pulseOpacity =
    frame >= 70 && frame < 150
      ? 0.06 + 0.04 * Math.sin((frame - 70) * 0.15)
      : 0;

  // ---- CAMERA ANIMATION ----
  // Phase 1 (0-60): Full dashboard zooms in from 0.92 to 1.0
  // Phase 2 (60-110): Slow zoom into KPI cards + broken codes area (top-left focus)
  // Phase 3 (110-160): Pan down to the table, zoom into broken rows
  // Phase 4 (160-210): Zoom into Revenue at Risk badge (top-right)
  // Phase 5 (210-240): Pull back to full view

  const scale = interpolate(
    frame,
    [0, 30, 60, 110, 160, 195, 240],
    [0.92, 1.0, 1.0, 1.18, 1.25, 1.15, 1.0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );

  const translateX = interpolate(
    frame,
    [0, 60, 110, 160, 195, 240],
    [0, 0, -40, 15, 120, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );

  const translateY = interpolate(
    frame,
    [0, 60, 110, 160, 195, 240],
    [0, 0, -30, 50, -60, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: entrance,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Polaris-styled dashboard card - centered, ~58% width - with camera transform */}
      <div
        style={{
          width: "58%",
          maxWidth: 1120,
          minWidth: 900,
          background: P.surface,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 25px 80px rgba(0,0,0,0.5)",
          position: "relative",
          zIndex: 1,
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          transition: "transform 0.05s ease-out",
        }}
      >
        {/* Shopify top bar */}
        <div
          style={{
            background: P.topBar,
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Shopify bag icon (simplified) */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "#5c6ac4",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 900,
              color: "#fff",
            }}
          >
            S
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
            My Store
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            Apps &rsaquo; CouponMaxx
          </div>
        </div>

        {/* Page header */}
        <div
          style={{
            padding: "20px 24px 0",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: P.textPrimary }}>
              Coupon Intelligence
            </div>
            <div style={{ fontSize: 13, color: P.textSubdued, marginTop: 2 }}>
              Track every coupon code across your store
            </div>
          </div>
          {/* Revenue at Risk banner */}
          <div
            style={{
              background: P.bgCriticalSubdued,
              border: `1px solid ${P.bgCritical}`,
              borderRadius: 10,
              padding: "10px 18px",
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: 11, color: P.textCritical, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Revenue at Risk
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: P.textCritical, marginTop: 2 }}>
              ${riskValue.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: P.textSubdued }}>last 7 days</div>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: "flex", gap: 12, padding: "16px 24px" }}>
          <PolarisKPI label="Total Codes" value="24" trend="4 new this week" trendUp delay={10} />
          <PolarisKPI label="Broken" value="5" trend="2 more than last week" trendUp={false} delay={20} />
          <PolarisKPI label="Degraded" value="3" trend="<50% success" delay={30} />
          <PolarisKPI label="Healthy" value="16" trend="88% avg success" trendUp delay={40} />
        </div>

        {/* Data table */}
        <div
          style={{
            margin: "0 24px 20px",
            background: P.surfaceDefault,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: P.shadow,
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: "flex",
              padding: "10px 20px",
              borderBottom: `1px solid ${P.border}`,
              fontSize: 12,
              color: P.textSubdued,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              background: "#fafbfb",
            }}
          >
            <div style={{ flex: 2 }}>Code</div>
            <div style={{ flex: 1 }}>Status</div>
            <div style={{ flex: 1, textAlign: "center" }}>Attempts</div>
            <div style={{ flex: 1, textAlign: "center" }}>Success</div>
            <div style={{ flex: 1, textAlign: "center" }}>Avg Cart</div>
            <div style={{ flex: 1, textAlign: "center" }}>Recoveries</div>
          </div>

          {/* Rows with pulse highlight on broken */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 135,
                background: `rgba(215, 44, 13, ${pulseOpacity})`,
                pointerEvents: "none",
                borderRadius: 4,
              }}
            />
            <CouponRow code="SAVE20" status="critical" statusLabel="Broken" attempts={342} successRate={0} avgCart="$87" recoveries={28} delay={55} />
            <CouponRow code="INFLUENCER25" status="critical" statusLabel="Broken" attempts={189} successRate={0} avgCart="$134" recoveries={15} delay={62} />
            <CouponRow code="SUMMER10" status="critical" statusLabel="Broken" attempts={76} successRate={0} avgCart="$62" recoveries={8} delay={69} />
            <CouponRow code="WELCOME15" status="success" statusLabel="Healthy" attempts={1204} successRate={94} avgCart="$95" recoveries={0} delay={76} />
            <CouponRow code="VIP30" status="success" statusLabel="Healthy" attempts={567} successRate={88} avgCart="$210" recoveries={0} delay={83} />
            <CouponRow code="FRIEND10" status="warning" statusLabel="Degraded" attempts={423} successRate={42} avgCart="$78" recoveries={12} delay={90} />
            <CouponRow code="PODCAST20" status="warning" statusLabel="Degraded" attempts={298} successRate={35} avgCart="$112" recoveries={19} delay={97} />
          </div>
        </div>
      </div>
    </div>
  );
};

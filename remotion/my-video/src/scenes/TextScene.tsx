import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1 = spring({ frame: frame - 10, fps, config: { damping: 14 } });
  const line2 = spring({ frame: frame - 25, fps, config: { damping: 14 } });
  const line3 = spring({ frame: frame - 45, fps, config: { damping: 14 } });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Animated background circles */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%)",
          top: "20%",
          left: "30%",
          transform: `scale(${1 + Math.sin(frame * 0.03) * 0.1})`,
        }}
      />

      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: "#fff",
          textAlign: "center",
          lineHeight: 1.2,
          opacity: line1,
          transform: `translateY(${interpolate(line1, [0, 1], [30, 0])}px)`,
        }}
      >
        What happens when a
      </div>
      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: "#ef4444",
          textAlign: "center",
          lineHeight: 1.2,
          marginTop: 8,
          opacity: line2,
          transform: `translateY(${interpolate(line2, [0, 1], [30, 0])}px)`,
        }}
      >
        coupon code fails?
      </div>
      <div
        style={{
          fontSize: 20,
          color: "rgba(255,255,255,0.5)",
          marginTop: 24,
          opacity: line3,
          transform: `translateY(${interpolate(line3, [0, 1], [15, 0])}px)`,
        }}
      >
        Your customers try. They fail. They leave.
      </div>
    </div>
  );
};

export const BlindSpotScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const main = spring({ frame: frame - 5, fps, config: { damping: 14 } });
  const sub = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  const reveal = spring({ frame: frame - 45, fps, config: { damping: 12 } });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 800,
          color: "#fff",
          textAlign: "center",
          opacity: main,
          transform: `translateY(${interpolate(main, [0, 1], [20, 0])}px)`,
        }}
      >
        You never saw this happen.
      </div>
      <div
        style={{
          fontSize: 20,
          color: "rgba(255,255,255,0.5)",
          marginTop: 16,
          textAlign: "center",
          opacity: sub,
        }}
      >
        No tracking. No alerts. No recovery.
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#f59e0b",
          marginTop: 40,
          opacity: reveal,
          transform: `scale(${interpolate(reveal, [0, 1], [0.8, 1])})`,
        }}
      >
        Until now.
      </div>
    </div>
  );
};

export const RecoveryIntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const main = spring({ frame: frame - 5, fps, config: { damping: 14 } });
  const sub = spring({ frame: frame - 25, fps, config: { damping: 14 } });
  const badge = spring({ frame: frame - 40, fps, config: { damping: 10, stiffness: 100 } });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        position: "relative",
      }}
    >
      <div
        style={{
          background: "rgba(34, 197, 94, 0.15)",
          border: "1px solid rgba(34, 197, 94, 0.3)",
          borderRadius: 8,
          padding: "6px 16px",
          fontSize: 13,
          fontWeight: 600,
          color: "#22c55e",
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: 20,
          opacity: badge,
          transform: `scale(${interpolate(badge, [0, 1], [0.5, 1])})`,
        }}
      >
        Smart Recovery
      </div>
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          color: "#fff",
          textAlign: "center",
          lineHeight: 1.2,
          opacity: main,
          transform: `translateY(${interpolate(main, [0, 1], [20, 0])}px)`,
        }}
      >
        Rescue every failed coupon.
      </div>
      <div
        style={{
          fontSize: 20,
          color: "rgba(255,255,255,0.5)",
          marginTop: 16,
          textAlign: "center",
          maxWidth: 700,
          opacity: sub,
        }}
      >
        Expired code? We instantly offer a working replacement — right in the cart.
      </div>
    </div>
  );
};

export const ResultsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Counter animation
  const countProgress = Math.min(1, Math.max(0, (frame - 15) / 45));
  const eased = 1 - Math.pow(1 - countProgress, 3); // ease out cubic

  const codesRecovered = Math.floor(eased * 82);
  const revenueRecovered = Math.floor(eased * 12450);
  const conversionLift = (eased * 23.5).toFixed(1);

  const card1 = spring({ frame: frame - 5, fps, config: { damping: 14 } });
  const card2 = spring({ frame: frame - 15, fps, config: { damping: 14 } });
  const card3 = spring({ frame: frame - 25, fps, config: { damping: 14 } });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #0d2818 50%, #0f0f23 100%)",
        position: "relative",
        gap: 40,
      }}
    >
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 3 }}>
        The Results
      </div>

      <div style={{ display: "flex", gap: 30 }}>
        {/* Stat card 1 */}
        <div
          style={{
            width: 280,
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: 16,
            padding: "32px 28px",
            textAlign: "center",
            opacity: card1,
            transform: `translateY(${interpolate(card1, [0, 1], [20, 0])}px)`,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800, color: "#22c55e" }}>
            {codesRecovered}
          </div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
            Coupons Recovered
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            this month
          </div>
        </div>

        {/* Stat card 2 */}
        <div
          style={{
            width: 280,
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: 16,
            padding: "32px 28px",
            textAlign: "center",
            opacity: card2,
            transform: `translateY(${interpolate(card2, [0, 1], [20, 0])}px)`,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800, color: "#22c55e" }}>
            ${revenueRecovered.toLocaleString()}
          </div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
            Revenue Recovered
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            from abandoned carts
          </div>
        </div>

        {/* Stat card 3 */}
        <div
          style={{
            width: 280,
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: 16,
            padding: "32px 28px",
            textAlign: "center",
            opacity: card3,
            transform: `translateY(${interpolate(card3, [0, 1], [20, 0])}px)`,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800, color: "#22c55e" }}>
            +{conversionLift}%
          </div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
            Conversion Lift
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            coupon-assisted orders
          </div>
        </div>
      </div>
    </div>
  );
};

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logo = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 80 } });
  const tagline = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  const cta = spring({ frame: frame - 40, fps, config: { damping: 12 } });

  // Gentle pulse on CTA
  const pulse = 1 + Math.sin(frame * 0.08) * 0.02;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        position: "relative",
      }}
    >
      {/* Glow */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)",
          top: "25%",
          left: "35%",
        }}
      />

      {/* Logo / Brand */}
      <div
        style={{
          opacity: logo,
          transform: `scale(${interpolate(logo, [0, 1], [0.7, 1])})`,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 900,
            color: "#fff",
          }}
        >
          C
        </div>
        <div>
          <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", letterSpacing: -1 }}>
            CouponMaxx
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 22,
          color: "rgba(255,255,255,0.6)",
          marginTop: 20,
          textAlign: "center",
          opacity: tagline,
          transform: `translateY(${interpolate(tagline, [0, 1], [10, 0])}px)`,
        }}
      >
        Turn failed coupons into recovered revenue.
      </div>

      {/* CTA button */}
      <div
        style={{
          marginTop: 40,
          background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
          padding: "16px 40px",
          borderRadius: 12,
          fontSize: 18,
          fontWeight: 700,
          color: "#fff",
          opacity: cta,
          transform: `scale(${interpolate(cta, [0, 1], [0.8, 1]) * pulse})`,
          boxShadow: "0 8px 30px rgba(59, 130, 246, 0.3)",
        }}
      >
        Try Free on Shopify
      </div>

      {/* Subtle features list */}
      <div
        style={{
          display: "flex",
          gap: 30,
          marginTop: 30,
          opacity: cta * 0.6,
        }}
      >
        {["Coupon Intelligence", "Smart Recovery", "Real-time Analytics"].map(
          (feat, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.4)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ color: "#22c55e" }}>&#10003;</span>
              {feat}
            </div>
          )
        )}
      </div>
    </div>
  );
};

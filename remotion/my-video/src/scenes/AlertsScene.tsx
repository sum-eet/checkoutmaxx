import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

// Polaris tokens
const P = {
  textPrimary: "#202223",
  textSubdued: "#6d7175",
  textCritical: "#d72c0d",
  textWarning: "#b98900",
  bgCritical: "#fed3d1",
  bgWarning: "#ffea8a",
  border: "#e1e3e5",
};

const SlackMessage: React.FC<{
  botName: string;
  botEmoji: string;
  channel: string;
  time: string;
  badge?: { text: string; color: string; bg: string };
  title: string;
  body: string;
  fields?: { label: string; value: string }[];
  accentColor: string;
  delay: number;
}> = ({ botName, botEmoji, time, badge, title, body, fields, accentColor, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12 } });

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 20px",
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [20, 0])}px)`,
      }}
    >
      {/* Bot avatar */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: "#f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        {botEmoji}
      </div>

      <div style={{ flex: 1 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: P.textPrimary }}>
            {botName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#fff",
              background: "#4a154b",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            APP
          </span>
          <span style={{ fontSize: 11, color: P.textSubdued }}>{time}</span>
        </div>

        {/* Attachment card */}
        <div
          style={{
            marginTop: 6,
            borderLeft: `3px solid ${accentColor}`,
            padding: "10px 14px",
            background: "#fafafa",
            borderRadius: "0 6px 6px 0",
          }}
        >
          {badge && (
            <span
              style={{
                display: "inline-block",
                fontSize: 11,
                fontWeight: 600,
                color: badge.color,
                background: badge.bg,
                padding: "2px 8px",
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              {badge.text}
            </span>
          )}
          <div style={{ fontSize: 14, fontWeight: 700, color: accentColor }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: P.textSubdued, marginTop: 4, lineHeight: 1.4 }}>
            {body}
          </div>
          {fields && (
            <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
              {fields.map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: P.textSubdued, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {f.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.textPrimary, marginTop: 2 }}>
                    {f.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const EmailNotification: React.FC<{
  subject: string;
  preview: string;
  severity: "critical" | "warning";
  time: string;
  delay: number;
}> = ({ subject, preview, severity, time, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12 } });

  const colors = {
    critical: { dot: P.textCritical, bg: "#fff8f7" },
    warning: { dot: P.textWarning, bg: "#fffcf0" },
  };
  const c = colors[severity];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 20px",
        borderBottom: `1px solid ${P.border}`,
        background: c.bg,
        gap: 12,
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [30, 0])}px)`,
      }}
    >
      {/* Unread dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: c.dot,
          flexShrink: 0,
        }}
      />
      {/* Sender icon */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
          color: "#fff",
          flexShrink: 0,
        }}
      >
        C
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: P.textPrimary }}>
            CouponMaxx
          </span>
          <span style={{ fontSize: 11, color: P.textSubdued }}>{time}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: P.textPrimary, marginTop: 2 }}>
          {subject}
        </div>
        <div
          style={{
            fontSize: 12,
            color: P.textSubdued,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {preview}
        </div>
      </div>
    </div>
  );
};

export const AlertsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 16 } });

  // Notification count animation
  const countStart = 60;
  const notifCount = frame >= countStart
    ? Math.min(7, Math.floor((frame - countStart) / 8))
    : 0;

  // Red dot pulse
  const dotPulse = 1 + Math.sin(frame * 0.15) * 0.3;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
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

      {/* Slack panel */}
      <div
        style={{
          width: 500,
          background: "#fff",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Slack header bar */}
        <div
          style={{
            background: "#4a154b",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Slack hash icon */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="5" width="12" height="1.5" rx="0.75" fill="rgba(255,255,255,0.8)" />
              <rect x="2" y="9.5" width="12" height="1.5" rx="0.75" fill="rgba(255,255,255,0.8)" />
              <rect x="5" y="2" width="1.5" height="12" rx="0.75" fill="rgba(255,255,255,0.8)" />
              <rect x="9.5" y="2" width="1.5" height="12" rx="0.75" fill="rgba(255,255,255,0.8)" />
            </svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
            coupon-alerts
          </span>
          {notifCount > 0 && (
            <div
              style={{
                background: "#e01e5a",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
                transform: `scale(${dotPulse})`,
              }}
            >
              {notifCount}
            </div>
          )}
        </div>

        {/* Slack messages */}
        <div style={{ maxHeight: 420 }}>
          <SlackMessage
            botName="CouponMaxx"
            botEmoji={"\uD83D\uDEA8"}
            channel="coupon-alerts"
            time="2:34 PM"
            badge={{ text: "CRITICAL", color: P.textCritical, bg: P.bgCritical }}
            title="Coupon SAVE20 failed 20 times today"
            body="Code &quot;SAVE20&quot; has a 0% success rate with 342 total attempts. This code appears expired."
            fields={[
              { label: "Failures today", value: "20" },
              { label: "Revenue at risk", value: "$1,740" },
              { label: "Top source", value: "Instagram" },
            ]}
            accentColor={P.textCritical}
            delay={15}
          />

          <div style={{ borderTop: `1px solid ${P.border}` }} />

          <SlackMessage
            botName="CouponMaxx"
            botEmoji={"\uD83D\uDCC9"}
            channel="coupon-alerts"
            time="1:12 PM"
            badge={{ text: "WARNING", color: P.textWarning, bg: P.bgWarning }}
            title="Meta traffic drop-off rate spiked 34%"
            body="Visitors from Meta ads are abandoning carts 34% more than last week. 68% tried a coupon code that failed."
            fields={[
              { label: "Source", value: "Meta Ads" },
              { label: "Drop-off", value: "+34%" },
              { label: "Failed codes", value: "68%" },
            ]}
            accentColor={P.textWarning}
            delay={50}
          />
        </div>
      </div>

      {/* Email panel */}
      <div
        style={{
          width: 400,
          background: "#fff",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Email header */}
        <div
          style={{
            background: "#f6f6f7",
            padding: "14px 20px",
            borderBottom: `1px solid ${P.border}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="3" width="16" height="12" rx="2" stroke="#6d7175" strokeWidth="1.5" fill="none" />
            <path d="M1 5l8 5 8-5" stroke="#6d7175" strokeWidth="1.5" fill="none" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color: P.textPrimary }}>
            Inbox
          </span>
          {notifCount > 0 && (
            <div
              style={{
                background: "#3b82f6",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {Math.min(4, notifCount)}
            </div>
          )}
        </div>

        {/* Email rows */}
        <EmailNotification
          subject="Alert: SAVE20 hit 20 failures"
          preview="The coupon code SAVE20 has failed 20 times today with $1,740 in cart value at risk..."
          severity="critical"
          time="2:34 PM"
          delay={30}
        />
        <EmailNotification
          subject="Meta traffic dropping off at cart"
          preview="Visitors from your Meta campaigns are abandoning carts 34% more than..."
          severity="warning"
          time="1:12 PM"
          delay={60}
        />
        <EmailNotification
          subject="Weekly Digest: 5 codes need attention"
          preview="3 broken codes, 2 degraded. Smart Recovery saved 28 orders this week..."
          severity="warning"
          time="9:00 AM"
          delay={85}
        />
        <EmailNotification
          subject="Smart Recovery: 12 carts saved today"
          preview="Your recovery rules converted 12 abandoned carts worth $2,340 in the last 24h..."
          severity="critical"
          time="Yesterday"
          delay={105}
        />
      </div>
    </div>
  );
};

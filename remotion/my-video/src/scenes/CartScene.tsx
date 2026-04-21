import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

const CartItem: React.FC<{
  name: string;
  variant: string;
  price: string;
  image: string;
  delay: number;
}> = ({ name, variant, price, image, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame: frame - delay, fps, config: { damping: 20 } });
  const translateX = interpolate(
    spring({ frame: frame - delay, fps, config: { damping: 20 } }),
    [0, 1],
    [-30, 0]
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 0",
        borderBottom: "1px solid #e5e7eb",
        opacity,
        transform: `translateX(${translateX}px)`,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 10,
          background: image,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>
          {name}
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
          {variant}
        </div>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>
        {price}
      </div>
    </div>
  );
};

export const CartFrustrationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scene timing (relative to this sequence)
  const cartAppear = 0;
  const firstCodeStart = 30; // 1s - start typing first code
  const firstCodeSubmit = 60; // 2s - press apply
  const firstError = 70; // 2.3s - error appears
  const shakeStart = 72;
  const secondCodeStart = 120; // 4s - type second code
  const secondCodeSubmit = 150; // 5s
  const secondError = 160; // 5.3s
  const secondShake = 162;
  const frustrationStart = 200; // 6.7s
  const fadeOut = 260; // 8.7s

  // Cart slide in
  const cartScale = spring({
    frame: frame - cartAppear,
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  // Shake on error
  const shake1 =
    frame >= shakeStart && frame < shakeStart + 12
      ? Math.sin((frame - shakeStart) * 2.5) * 6 * (1 - (frame - shakeStart) / 12)
      : 0;

  const shake2 =
    frame >= secondShake && frame < secondShake + 12
      ? Math.sin((frame - secondShake) * 2.5) * 8 * (1 - (frame - secondShake) / 12)
      : 0;

  // First code visibility
  const showFirstCode = frame >= firstCodeStart;
  const firstCodeDone = frame >= firstCodeSubmit;
  const firstErrorVisible = frame >= firstError;

  // Second code
  const showSecondCode = frame >= secondCodeStart;
  const secondCodeDone = frame >= secondCodeSubmit;
  const secondErrorVisible = frame >= secondError;

  // Error flash
  const errorFlash1 =
    frame >= firstError && frame < firstError + 6
      ? interpolate(frame, [firstError, firstError + 6], [0.15, 0])
      : 0;
  const errorFlash2 =
    frame >= secondError && frame < secondError + 6
      ? interpolate(frame, [secondError, secondError + 6], [0.2, 0])
      : 0;

  // Frustration overlay
  const frustrationOpacity =
    frame >= frustrationStart
      ? interpolate(frame, [frustrationStart, frustrationStart + 20], [0, 1], {
          extrapolateRight: "clamp",
        })
      : 0;

  // Scene fade out
  const sceneOpacity =
    frame >= fadeOut
      ? interpolate(frame, [fadeOut, fadeOut + 20], [1, 0], {
          extrapolateRight: "clamp",
        })
      : 1;

  // Current coupon input text
  let couponText = "";
  if (showSecondCode) {
    couponText = secondCodeDone ? "SUMMER10" : "";
    if (!secondCodeDone && frame >= secondCodeStart) {
      const chars = Math.min(8, Math.floor((frame - secondCodeStart) / 3));
      couponText = "SUMMER10".slice(0, chars);
    }
  } else if (showFirstCode) {
    couponText = firstCodeDone ? "SAVE20" : "";
    if (!firstCodeDone && frame >= firstCodeStart) {
      const chars = Math.min(6, Math.floor((frame - firstCodeStart) / 3));
      couponText = "SAVE20".slice(0, chars);
    }
  }

  // Error messages
  const errorMsg1 = firstErrorVisible && !showSecondCode ? "Coupon code \"SAVE20\" has expired" : null;
  const errorMsg2 = secondErrorVisible ? "Coupon code \"SUMMER10\" is not valid" : null;
  const currentError = errorMsg2 || errorMsg1;

  // Attempt counter
  const attemptCount = secondErrorVisible ? 2 : firstErrorVisible ? 1 : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
        opacity: sceneOpacity,
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
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Red flash overlay on errors */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(239, 68, 68, ${errorFlash1 + errorFlash2})`,
          pointerEvents: "none",
          zIndex: 10,
        }}
      />

      {/* Cart container */}
      <div
        style={{
          width: 520,
          background: "#ffffff",
          borderRadius: 16,
          boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
          transform: `scale(${cartScale}) translateX(${shake1 + shake2}px)`,
        }}
      >
        {/* Cart header */}
        <div
          style={{
            padding: "20px 28px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
            Your Cart
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#6b7280",
              background: "#f3f4f6",
              padding: "4px 12px",
              borderRadius: 20,
            }}
          >
            3 items
          </div>
        </div>

        {/* Cart items */}
        <div style={{ padding: "8px 28px" }}>
          <CartItem
            name="Premium Wireless Headphones"
            variant="Matte Black / Over-ear"
            price="$129.99"
            image="linear-gradient(135deg, #374151 0%, #111827 100%)"
            delay={5}
          />
          <CartItem
            name="USB-C Charging Cable"
            variant="6ft / Braided Nylon"
            price="$24.99"
            image="linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)"
            delay={10}
          />
          <CartItem
            name="Phone Case - Clear"
            variant="iPhone 15 Pro Max"
            price="$34.99"
            image="linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)"
            delay={15}
          />
        </div>

        {/* Subtotal */}
        <div
          style={{
            padding: "16px 28px",
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <span style={{ fontSize: 15, color: "#6b7280" }}>Subtotal</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>
            $189.97
          </span>
        </div>

        {/* Coupon input */}
        <div style={{ padding: "0 28px 20px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                flex: 1,
                border: currentError
                  ? "2px solid #ef4444"
                  : "1px solid #d1d5db",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 15,
                color: couponText ? "#1a1a2e" : "#9ca3af",
                background: currentError
                  ? "rgba(239, 68, 68, 0.04)"
                  : "#fff",
                display: "flex",
                alignItems: "center",
                fontFamily: "monospace",
                letterSpacing: 1,
                transition: "all 0.2s",
              }}
            >
              {couponText || "Discount code"}
              {showFirstCode && !firstCodeDone && !showSecondCode && (
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 18,
                    background: "#1a1a2e",
                    marginLeft: 1,
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }}
                />
              )}
              {showSecondCode && !secondCodeDone && (
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 18,
                    background: "#1a1a2e",
                    marginLeft: 1,
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }}
                />
              )}
            </div>
            <button
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background:
                  (firstCodeDone && !showSecondCode) || secondCodeDone
                    ? "#d1d5db"
                    : "#1a1a2e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Apply
            </button>
          </div>

          {/* Error message */}
          {currentError && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                fontSize: 13,
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: spring({
                  frame: frame - (errorMsg2 ? secondError : firstError),
                  fps,
                  config: { damping: 12 },
                }),
              }}
            >
              <span style={{ fontSize: 16 }}>&#10007;</span>
              {currentError}
            </div>
          )}

          {/* Attempt counter badge */}
          {attemptCount > 0 && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: 0.7,
              }}
            >
              {Array.from({ length: attemptCount }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#ef4444",
                  }}
                />
              ))}
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                {attemptCount} failed attempt{attemptCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Frustration overlay */}
      {frustrationOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: `rgba(15, 15, 35, ${frustrationOpacity * 0.85})`,
            zIndex: 20,
          }}
        >
          <div
            style={{
              fontSize: 72,
              opacity: frustrationOpacity,
              transform: `scale(${interpolate(frustrationOpacity, [0, 1], [0.5, 1])})`,
            }}
          >
            &#128548;
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#ef4444",
              marginTop: 16,
              opacity: frustrationOpacity,
              letterSpacing: -0.5,
            }}
          >
            Customer abandoned cart
          </div>
          <div
            style={{
              fontSize: 20,
              color: "rgba(255,255,255,0.5)",
              marginTop: 8,
              opacity: frustrationOpacity,
            }}
          >
            $189.97 in revenue — lost forever
          </div>
        </div>
      )}
    </div>
  );
};

export const CartRecoveryScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Timing
  const codeType = 0;
  const codeSubmit = 30;
  const errorAppear = 40;
  const recoveryAppear = 70; // 2.3s
  const codeCopy = 130; // 4.3s
  const codeApply = 160; // 5.3s
  const successAppear = 175; // 5.8s
  const celebrationStart = 185;

  // Shake on error
  const shake =
    frame >= 42 && frame < 54
      ? Math.sin((frame - 42) * 2.5) * 6 * (1 - (frame - 42) / 12)
      : 0;

  // Code typing
  let couponText = "";
  if (frame >= codeApply) {
    couponText = "SAVE-7X92";
  } else if (frame >= codeCopy) {
    const chars = Math.min(9, Math.floor((frame - codeCopy) / 2));
    couponText = "SAVE-7X92".slice(0, chars);
  } else if (frame >= codeSubmit) {
    couponText = "INFLUENCER25";
  } else if (frame >= codeType) {
    const chars = Math.min(12, Math.floor((frame - codeType) / 2.5));
    couponText = "INFLUENCER25".slice(0, chars);
  }

  const showError = frame >= errorAppear && frame < successAppear;
  const showRecovery = frame >= recoveryAppear;
  const showSuccess = frame >= successAppear;
  const showCopied = frame >= codeCopy && frame < codeCopy + 30;

  const recoverySpring = spring({
    frame: frame - recoveryAppear,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const successSpring = spring({
    frame: frame - successAppear,
    fps,
    config: { damping: 12 },
  });

  // Green flash on success
  const successFlash =
    frame >= successAppear && frame < successAppear + 8
      ? interpolate(frame, [successAppear, successAppear + 8], [0.15, 0])
      : 0;

  // Celebration particles
  const showCelebration = frame >= celebrationStart;

  // Scene entrance
  const entrance = spring({
    frame,
    fps,
    config: { damping: 15 },
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
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
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Green flash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(34, 197, 94, ${successFlash})`,
          pointerEvents: "none",
          zIndex: 10,
        }}
      />

      {/* Red flash on error */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(239, 68, 68, ${
            frame >= 40 && frame < 46
              ? interpolate(frame, [40, 46], [0.12, 0])
              : 0
          })`,
          pointerEvents: "none",
          zIndex: 10,
        }}
      />

      {/* Celebration particles */}
      {showCelebration &&
        Array.from({ length: 20 }).map((_, i) => {
          const angle = (i / 20) * Math.PI * 2;
          const speed = 3 + (i % 5) * 1.5;
          const elapsed = frame - celebrationStart;
          const x = Math.cos(angle) * speed * elapsed;
          const y = Math.sin(angle) * speed * elapsed - 0.1 * elapsed * elapsed;
          const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 8,
                height: 8,
                borderRadius: i % 2 === 0 ? "50%" : 2,
                background: colors[i % colors.length],
                transform: `translate(${x}px, ${y}px) rotate(${elapsed * 5 + i * 30}deg)`,
                opacity: Math.max(0, 1 - elapsed / 60),
                zIndex: 5,
              }}
            />
          );
        })}

      {/* Cart */}
      <div
        style={{
          width: 520,
          background: "#ffffff",
          borderRadius: 16,
          boxShadow: showSuccess
            ? `0 25px 60px rgba(0,0,0,0.4), 0 0 40px rgba(34, 197, 94, ${successSpring * 0.3})`
            : "0 25px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
          transform: `scale(${entrance}) translateX(${shake}px)`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 28px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
            Your Cart
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#6b7280",
              background: "#f3f4f6",
              padding: "4px 12px",
              borderRadius: 20,
            }}
          >
            3 items
          </div>
        </div>

        {/* Compact items */}
        <div style={{ padding: "12px 28px" }}>
          <CartItem
            name="Premium Wireless Headphones"
            variant="Matte Black / Over-ear"
            price="$129.99"
            image="linear-gradient(135deg, #374151 0%, #111827 100%)"
            delay={0}
          />
          <CartItem
            name="USB-C Charging Cable"
            variant="6ft / Braided Nylon"
            price="$24.99"
            image="linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)"
            delay={0}
          />
        </div>

        {/* Subtotal */}
        <div
          style={{
            padding: "12px 28px",
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <span style={{ fontSize: 15, color: "#6b7280" }}>Subtotal</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: showSuccess ? "#16a34a" : "#1a1a2e" }}>
            {showSuccess ? (
              <>
                <span style={{ textDecoration: "line-through", color: "#9ca3af", marginRight: 8, fontSize: 14 }}>
                  $154.98
                </span>
                $139.48
              </>
            ) : (
              "$154.98"
            )}
          </span>
        </div>

        {/* Coupon section */}
        <div style={{ padding: "0 28px 20px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                flex: 1,
                border: showSuccess
                  ? "2px solid #22c55e"
                  : showError
                  ? "2px solid #ef4444"
                  : "1px solid #d1d5db",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 15,
                color: couponText ? "#1a1a2e" : "#9ca3af",
                background: showSuccess
                  ? "rgba(34, 197, 94, 0.04)"
                  : showError
                  ? "rgba(239, 68, 68, 0.04)"
                  : "#fff",
                fontFamily: "monospace",
                letterSpacing: 1,
              }}
            >
              {couponText || "Discount code"}
            </div>
            <button
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: showSuccess ? "#22c55e" : "#1a1a2e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {showSuccess ? "&#10003;" : "Apply"}
            </button>
          </div>

          {/* Error message */}
          {showError && !showSuccess && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                fontSize: 13,
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>&#10007;</span>
              Coupon code &quot;INFLUENCER25&quot; has expired
            </div>
          )}

          {/* SMART RECOVERY BANNER */}
          {showRecovery && !showSuccess && (
            <div
              style={{
                marginTop: 8,
                padding: "12px 16px",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                opacity: recoverySpring,
                transform: `translateY(${interpolate(recoverySpring, [0, 1], [8, 0])}px)`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                  That code expired — try this one:
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    background: showCopied ? "#dcfce7" : "#fef3c7",
                    border: showCopied
                      ? "1.5px solid #86efac"
                      : "1.5px dashed #f59e0b",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontFamily: "monospace",
                    fontSize: 15,
                    fontWeight: 700,
                    color: showCopied ? "#16a34a" : "#92400e",
                    letterSpacing: 1.5,
                    cursor: "pointer",
                  }}
                >
                  {showCopied ? "Copied!" : "SAVE-7X92"}
                </div>
                <div style={{ fontSize: 11, color: "#b45309", whiteSpace: "nowrap" }}>
                  15 min
                </div>
              </div>
            </div>
          )}

          {/* Success message */}
          {showSuccess && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 14px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                fontSize: 14,
                color: "#16a34a",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: successSpring,
              }}
            >
              <span style={{ fontSize: 16 }}>&#10003;</span>
              10% discount applied — you saved $15.50!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

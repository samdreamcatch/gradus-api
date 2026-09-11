type LogoProps = {
  className?: string;
};

/**
 * Gradus wordmark — serif display type with a flat highlighter stripe
 * running through the lower-middle band, extending past the right edge.
 */
export function Logo({ className }: LogoProps) {
  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        fontFamily: "var(--font-wordmark)",
        fontWeight: 600,
        fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 144',
        fontStyle: "normal",
        lineHeight: 1,
        color: "var(--text-primary)",
        letterSpacing: "-0.015em",
        paddingRight: "0.18em",
      }}
    >
      {/* Highlighter stripe — sits behind the glyphs */}
      <span
        aria-hidden="true"
        role="presentation"
        className="logo-stripe"
        style={{
          position: "absolute",
          left: "-0.02em",
          right: "-0.45em",
          top: "44%",
          height: "42%",
          background:
            "linear-gradient(to right, color-mix(in oklab, var(--logo-stripe-color) 90%, transparent) 0%, color-mix(in oklab, var(--logo-stripe-color) 60%, transparent) 50%, color-mix(in oklab, var(--logo-stripe-color) 25%, transparent) 80%, transparent 100%)",
          transform: "rotate(-2.5deg)",
          transformOrigin: "left center",
          opacity: "var(--logo-stripe-opacity, 1)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      <span style={{ position: "relative", zIndex: 1 }}>Gradus</span>
    </span>
  );
}

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
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        lineHeight: 1,
        color: "var(--text-primary)",
        letterSpacing: "-0.015em",
        paddingRight: "0.18em",
      }}
    >
      {/* Highlighter stripe — sits behind the glyphs */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-0.02em",
          right: "-0.14em",
          top: "44%",
          height: "42%",
          background: "var(--pen-tennis)",
          opacity: 0.85,
          transform: "rotate(-1deg)",
          transformOrigin: "left center",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>Gradus</span>
    </span>
  );
}

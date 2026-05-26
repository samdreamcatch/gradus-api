type LogoProps = {
  className?: string;
};

/**
 * Gradus wordmark with a hand-drawn marker highlight behind it.
 * Sized via font-size on the root; SVG scales with the text.
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
        letterSpacing: "-0.01em",
        padding: "0.1em 0.18em",
      }}
    >
      {/* Marker stroke — sits behind the glyphs */}
      <svg
        aria-hidden="true"
        viewBox="0 0 200 60"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
          transform: "rotate(-1.2deg)",
        }}
      >
        <path
          d="M6 22
             C 40 16, 90 14, 140 17
             C 170 19, 188 21, 196 24
             C 198 30, 196 38, 192 44
             C 150 47, 90 49, 30 46
             C 14 45, 6 43, 4 40
             C 2 34, 3 27, 6 22 Z"
          fill="var(--pen-tennis)"
          opacity="0.78"
        />
      </svg>
      <span style={{ position: "relative", zIndex: 1 }}>Gradus</span>
    </span>
  );
}

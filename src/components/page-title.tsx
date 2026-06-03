type PageTitleProps = {
  children: React.ReactNode;
  /** Optional subtitle rendered beneath in the hand font. */
  subtitle?: React.ReactNode;
};

/**
 * Large editorial page title with the same tilted, fading highlighter stripe
 * used by the Gradus wordmark (see src/components/logo.tsx). Weight is
 * intentionally medium (500) — lighter than the wordmark.
 */
export function PageTitle({ children, subtitle }: PageTitleProps) {
  return (
    <>
      <p
        className="font-display text-[28px] font-medium leading-[1.08] tracking-tight text-text-primary"
        style={{ letterSpacing: "-0.015em" }}
      >
        <span
          style={{
            position: "relative",
            display: "inline-block",
            paddingRight: "0.18em",
          }}
        >
          {/* Stripe — same treatment as the Logo */}
          <span
            aria-hidden="true"
            role="presentation"
            style={{
              position: "absolute",
              left: "-0.02em",
              right: "-0.45em",
              top: "44%",
              height: "42%",
              background:
                "linear-gradient(to right, color-mix(in oklab, var(--pen-tennis) 90%, transparent) 0%, color-mix(in oklab, var(--pen-tennis) 60%, transparent) 50%, color-mix(in oklab, var(--pen-tennis) 25%, transparent) 80%, transparent 100%)",
              transform: "rotate(-2.5deg)",
              transformOrigin: "left center",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />
          <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
        </span>
      </p>
      {subtitle ? (
        <p className="mt-2 font-hand text-xl text-text-secondary">{subtitle}</p>
      ) : null}
    </>
  );
}

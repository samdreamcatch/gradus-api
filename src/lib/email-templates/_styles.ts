// Gradus email design tokens — paper & ink, jelly-pen accent (Tennis).
// Body bg must remain #ffffff for inbox compatibility.
//
// Visual identity matches the founder "welcome" email:
//   - Flat cream-grey paper card (no watermark, no border, no radius)
//   - Large serif "Gradus" wordmark centered at top with a lime pen-highlight
//     stripe behind it, followed by a full-width hairline rule
//   - Big serif headings, humanist sans body
//   - Dark charcoal callout section for checklists/emphasis blocks
//   - Pill CTA in tennis lime with dark ink + dark hairline border

export const fonts = {
  display: 'Fraunces, Georgia, "Times New Roman", serif',
  body: '"Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  hand: '"Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
}

export const colors = {
  ink: '#1F2937',
  inkSoft: '#1F2937',
  meta: '#1F2937',
  hair: '#D9DCE3',
  paper: '#F1F3F7',
  charcoal: '#1B2530',
  charcoalInk: '#FFFFFF',
  penFill: '#C0DD27',
  penInk: '#2A3300',
  penWash: '#F7FCE6',
}

export const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: fonts.body,
  margin: 0,
  padding: '0',
}

export const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '640px',
  margin: '0 auto',
  padding: '0',
  backgroundColor: colors.paper,
}

export const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '640px',
  margin: '0 auto',
  padding: '0',
  backgroundColor: colors.paper,
}

// Outer lighter-grey band that wraps the cream paper card, giving the
// "page-on-page" feel from the founder Welcome email.
export const outerBand: React.CSSProperties = {
  backgroundColor: '#EDEEF2',
  padding: '24px 20px',
  width: '100%',
}

// Inner padding wrapper for the "paper" content above the dark callout.
export const pageInner: React.CSSProperties = {
  padding: '24px 44px 8px',
}


// Inner padding wrapper for content BELOW a dark callout (CTA + footer area).
export const pageInnerBottom: React.CSSProperties = {
  padding: '32px 44px 40px',
  textAlign: 'center' as const,
}

// Wordmark image — centered Gradus logo (dark ink + lime pen-highlight
// stripe). The source PNG is transparent so the paper card shows through.
export const wordmarkImg: React.CSSProperties = {
  display: 'block',
  margin: '0 auto 20px',
  height: 'auto',
  maxWidth: '200px',
  width: '100%',
}


// Full-width hairline that sits under the wordmark.
export const topRule: React.CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${colors.ink}`,
  margin: '0 0 36px',
  opacity: 0.9,
}

export const eyebrow: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.meta,
  margin: '0 0 16px',
}

export const h1: React.CSSProperties = {
  fontFamily: fonts.display,
  fontSize: '40px',
  fontWeight: 700,
  lineHeight: 1.08,
  letterSpacing: '-0.02em',
  color: colors.ink,
  margin: '0 0 28px',
}

export const text: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '16px',
  lineHeight: 1.6,
  color: colors.inkSoft,
  margin: '0 0 20px',
}

export const link: React.CSSProperties = {
  color: colors.ink,
  textDecoration: 'underline',
  textDecorationColor: colors.penFill,
  textDecorationThickness: '2px',
  textUnderlineOffset: '2px',
}

// Dark charcoal callout — used for checklists / emphasized blocks.
export const callout: React.CSSProperties = {
  backgroundColor: colors.charcoal,
  color: colors.charcoalInk,
  padding: '28px 36px',
  margin: '8px 0 32px',
}

export const calloutText: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '16px',
  lineHeight: 1.55,
  color: colors.charcoalInk,
  margin: '0 0 12px',
}

// Pill CTA — tennis lime with dark ink and a dark hairline border.
export const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: colors.penFill,
  color: colors.penInk,
  fontFamily: fonts.body,
  fontSize: '16px',
  fontWeight: 700,
  borderRadius: '9999px',
  padding: '16px 34px',
  textDecoration: 'none',
  border: `1px solid ${colors.penInk}`,
}

// Wrap the CTA in this to center it under the callout.
export const buttonWrap: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '4px 0 24px',
}

export const code: React.CSSProperties = {
  display: 'inline-block',
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '28px',
  fontWeight: 700,
  letterSpacing: '0.32em',
  color: colors.ink,
  backgroundColor: '#ffffff',
  border: `1px solid ${colors.hair}`,
  borderRadius: '14px',
  padding: '16px 24px',
  margin: '8px 0 24px',
}

export const divider: React.CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${colors.hair}`,
  margin: '28px 0 18px',
}

export const footer: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '13px',
  lineHeight: 1.55,
  color: colors.meta,
  margin: '0',
  textAlign: 'center' as const,
}

export const sign: React.CSSProperties = {
  fontFamily: fonts.hand,
  fontStyle: 'italic' as const,
  fontSize: '16px',
  color: colors.ink,
  margin: '24px 0 0',
}


// Gradus email design tokens — paper & ink, jelly-pen accent (Tennis).
// Body bg must remain #ffffff for inbox compatibility.

export const fonts = {
  display: 'Fraunces, Georgia, "Times New Roman", serif',
  body: '"Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  hand: 'Caveat, "Bradley Hand", cursive',
}

export const colors = {
  ink: '#1F2937',
  inkSoft: '#4B5563',
  meta: '#6B7280',
  hair: '#E6E7EB',
  paper: '#F8F9FC',
  penFill: '#C0DD27',
  penInk: '#333E00',
  penWash: '#F7FCE6',
}

export const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: fonts.body,
  margin: 0,
  padding: '32px 0',
}

export const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '560px',
  margin: '0 auto',
  padding: '40px 36px',
  backgroundColor: colors.paper,
  border: `1px solid ${colors.hair}`,
  borderRadius: '20px',
}

export const wordmark: React.CSSProperties = {
  fontFamily: fonts.display,
  fontSize: '20px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: colors.ink,
  margin: '0 0 4px',
}

export const eyebrow: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.meta,
  margin: '0 0 28px',
}

export const h1: React.CSSProperties = {
  fontFamily: fonts.display,
  fontSize: '32px',
  fontWeight: 600,
  lineHeight: 1.12,
  letterSpacing: '-0.015em',
  color: colors.ink,
  margin: '0 0 20px',
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

export const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: colors.penFill,
  color: colors.penInk,
  fontFamily: fonts.body,
  fontSize: '15px',
  fontWeight: 700,
  borderRadius: '9999px',
  padding: '14px 28px',
  textDecoration: 'none',
  border: `1px solid ${colors.penInk}`,
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
  margin: '32px 0 20px',
}

export const footer: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: '12px',
  lineHeight: 1.5,
  color: colors.meta,
  margin: '0',
}

export const sign: React.CSSProperties = {
  fontFamily: fonts.hand,
  fontSize: '22px',
  color: colors.ink,
  margin: '24px 0 0',
}

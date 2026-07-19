## Problems

Comparing the founder "Welcome to Gradus" email (target) to the current auth emails (signup, magic link, recovery, invite, email change, reauth):

1. **Excess vertical space** above the wordmark, between the wordmark and hairline, and between the hairline and heading.
2. **Missing horizontal padding** — eyebrow, heading, body, CTA all sit flush against the cream card edge.
3. **Missing outer lighter-grey band** — the Welcome email shows a soft lighter-grey layer surrounding the cream paper card. Auth emails jump straight from white body to the cream card with no in-between band.

Root causes:
- #2: only `Header` and the bottom footer block are wrapped in `PageInner`. All other content renders as a direct child of `<Container>` and inherits no side padding.
- #3: `main` (body) is `#ffffff` and `container` is the cream `#F1F3F7`. No intermediate wrapper exists.

## Fix

All edits stay in shared layout files so every auth template picks them up automatically.

### 1. `src/lib/email-templates/_styles.ts` — tighten header rhythm + add outer band

- `pageInner`: `padding: '40px 44px 8px'` → `'24px 44px 8px'`
- `wordmarkImg`: `margin: '0 auto 20px'` → `'0 auto 10px'`
- `topRule`: `margin: '0 0 36px'` → `'0 0 20px'`
- `eyebrow`: `margin: '0 0 16px'` → `'0 0 10px'`
- `h1`: `margin: '0 0 28px'` → `'0 0 20px'`
- Add a new `outerBand` style: `backgroundColor: '#EDEEF2'` (lighter than `#F1F3F7`, slightly darker than white), `padding: '24px 20px'`, `width: '100%'` — this is the softer surrounding layer.
- Keep `container` cream `#F1F3F7`, but drop its own outer margin so the band controls spacing.

### 2. `src/lib/email-templates/_layout.tsx` — export a `PageShell` wrapper

Add and export a small `PageShell` component that renders the outer band around its children:

```
export const PageShell = ({ children }) => (
  <div style={outerBand}>{children}</div>
);
```

### 3. Wrap each auth template's `<Container>` in `<PageShell>` and body content in `<PageInner>`

For each of `signup.tsx`, `magic-link.tsx`, `recovery.tsx`, `invite.tsx`, `email-change.tsx`, `reauthentication.tsx`:

```
<Body style={main}>
  <PageShell>
    <Container style={container}>
      <Header />
      <PageInner>
        {/* existing eyebrow, heading, body, button, fallback link, sign-off, divider, footer */}
      </PageInner>
    </Container>
  </PageShell>
</Body>
```

`Header` keeps its own `pageInner` wrapper + full-width `Hr`, so the hairline still spans the cream card edge-to-edge like the Welcome email.

No copy, image, color-token, font, or business-logic changes. After the edit, preview each of the six templates at `/admin/emails` to confirm the header rhythm, side padding on body content, and the outer lighter-grey band all match the Welcome screenshot.

## Look

- Bubble: squared corners (radius-md), tennis wash fill with a tennis-tinted
  border, small triangular tail bottom-left, existing card shadow. All from
  existing tokens (`--pen-tennis`, `--pen-tennis-wash`, `--pen-tennis-ink`) so
  dark mode follows automatically.
- The mark from the attached image is added as a small icon inside the bubble
  header and inside the minimized button. It is uploaded as a hosted asset
  rather than copied into the code, and rendered at the tennis ink colour in
  the bubble, and on tennis fill in the button.
- Steps, buttons, and the bottom sheet keep the components already in use — no
  new UI primitives, no hover effects (press only).

## Behaviour

- Close (×) collapses the bubble with a short scale-and-fade into the corner
  button; opening plays it in reverse. Motion respects reduced-motion settings.
- The minimized button is fixed bottom-right, sitting above the coach bottom
  navigation, and shows the remaining step count.
- Minimized/open state is remembered per coach in the browser, same storage key
  already used; the existing "dismissed forever" behaviour is replaced by
  minimize, so the checklist is always recoverable until all steps are done.
- Progress detection, the server function, and the first-visit sheet are
  unchanged.

## Technical notes

- Edits confined to `src/components/coach/getting-started-checklist.tsx` plus a
  new `src/assets/icon-mark.png.asset.json` pointer created with the asset CLI.
- Add state `minimized` alongside the existing stored flags; replace `dismissed`
  handling with it, keep `seen` for the first-run sheet.
- Bubble + tail via a wrapper div with a CSS triangle (`::after` through an
  inline element), using `bg-pen-tennis-wash`, `border-pen-tennis`, and
  `text-pen-tennis-ink` utilities already mapped in `@theme`.
- Minimized button: existing `Button` with `size="icon"` and `press`, wrapped in
  a fixed-position container with safe-area padding, `z` below sheets/overlays.
- Animation with `animate-scale-in` / `animate-scale-out` utilities already in
  the project.

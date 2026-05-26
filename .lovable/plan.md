# Align Tennis pen to design-system hex

Update the three Tennis pen tokens in `src/styles.css` to match the Gradus spec exactly:

| Token | Hex | OKLCH |
|---|---|---|
| `--pen-tennis` (fill) | `#8DE160` | `oklch(0.847 0.218 132)` |
| `--pen-tennis-ink` (ink-on-paper text) | `#1F4D00` | `oklch(0.339 0.118 132)` |
| `--pen-tennis-wash` (soft background) | `#F0FDE8` | `oklch(0.982 0.035 132)` |

Only `:root` changes. Dark-mode values stay brightened as before but re-tuned to the same hue (132). No other files touched. `--accent`, `--accent-foreground`, `--accent-ink` already resolve through these vars, so the login page "Gradus" highlight, the primary button, and the underlined "Sign up" link will all pick up the new green automatically.

No component, route, or layout changes.

---

For future small visual tweaks like this (text, color, font), you can use **Visual Edits** — click the Edit button at the bottom-left of the chat box, pick the element on the page, and change it directly. Free for direct property edits.

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/features/visual-edit">Read more about Visual Edits</presentation-link>
</presentation-actions>

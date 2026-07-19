Add the word "for" between the "Repeating" toggle button and the months input on the New code form, so it reads: **Repeating for [3] months**.

### Change
In `src/routes/_authenticated/admin.promo-codes.tsx`, inside the New code form's Duration row (around line 256), when `duration === "repeating"`, render a small "for" label immediately before the months `<Input>`. Style it to match the existing "months" suffix (`text-xs text-text-tertiary self-center`).

### Scope
- New code form only (the user's selection).
- Not touching the inline row editors in the All codes table.
- No database, server function, or logic changes.
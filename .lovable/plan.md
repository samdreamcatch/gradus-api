# RosterCard — Option A (name on its own row)

Edit `src/components/coach/roster-card.tsx` only. No new components, no token changes.

## Change

Split the current single flex row into two stacked rows inside the card body:

1. **Top row** — name (full width, `font-display`, current size) + kebab `DropdownMenu`. Uses `grid-cols-[minmax(0,1fr)_auto]` so the name always owns the leftover width and truncates only if a single word is genuinely too long.
2. **Bottom row** — the slot pills `<ul>` wraps freely beneath the name. Pill styling unchanged. `justify-start` instead of `justify-end` (reads left-to-right under the name). `mt-2` spacing.

Empty-schedule state ("No schedule") moves to the bottom row too, same `text-text-tertiary text-xs`.

## Diff sketch

```text
<div class="card …">
  <span class="accent stripe" />

  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
    <button class="… truncate font-display …">{name}</button>
    <DropdownMenu>…kebab…</DropdownMenu>
  </div>

  <div class="mt-2">
    {slots.length === 0
      ? <span class="text-xs text-text-tertiary">No schedule</span>
      : <ul class="flex flex-wrap gap-1">{pills}</ul>}
  </div>
</div>
```

## Notes

- No data/behavior changes — same `onSelect`, same remove mutation, same alert dialog.
- Card grows ~24px taller per athlete. Roster list spacing (`space-y-3`) stays.
- Truncation on the name becomes a true edge case (only triggers for names longer than the full card width), not a side-effect of slot count.

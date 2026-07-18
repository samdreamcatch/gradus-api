# Inline "Upgrade" button in roster-full card

Replace the full-width `<UpgradeToProRow />` block with a small inline `Button` aligned with the "Coach Pro raises this to 50 athletes." line.

## Change in `src/routes/_authenticated/coach.roster.tsx` (around lines 203–215)

```tsx
{rosterFull ? (
  <div className="mt-3 rounded-lg border border-divider bg-elevated p-3">
    <div className="text-sm font-bold text-text-primary">
      Your athlete roster is full — {athletes.length} / {athleteLimit}
    </div>
    <div className="mt-1 flex items-center justify-between gap-3">
      <p className="text-xs text-text-secondary">
        Coach Pro raises this to 50 athletes.
      </p>
      <Button
        size="sm"
        variant={coachProAvailable ? "default" : "outline"}
        disabled={!coachProAvailable}
        onClick={() =>
          navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } })
        }
        className="shrink-0"
      >
        {coachProAvailable ? "Upgrade" : "Upgrade · Soon"}
      </Button>
    </div>
  </div>
) : null}
```

- Drop the `<UpgradeToProRow />` import and its wrapper `<div className="mt-3">`.
- Add imports: `Button` from `@/components/ui/button`, `isCoachProAvailable` from `@/lib/paywall-flag`, and `useNavigate` from `@tanstack/react-router` if not already present. Compute `const coachProAvailable = isCoachProAvailable();` and `const navigate = useNavigate();` in the component (reuse existing if already there).
- Keeps the disabled/SOON semantics from `UpgradeToProRow` in a compact form. Detailed pricing copy is dropped — it lives on the paywall.

No other call sites of `UpgradeToProRow` are affected.

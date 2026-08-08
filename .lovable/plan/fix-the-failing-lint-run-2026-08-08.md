# Fix the failing lint run

`bun run lint` exits 1 with 2,204 problems. Every one of the 2,033 hard errors is a Prettier formatting difference — there are zero real code errors. The remaining 171 are warnings and do not fail the run.

## Why it's failing

`eslint.config.js` sets `"prettier/prettier": "warn"`, but the `eslintPluginPrettier` recommended preset is spread in as the **last** config entry, so it re-applies the rule at `"error"` severity and overrides the intended warning. On top of that, formatting has drifted again since the last Prettier pass.

## The fix

1. In `eslint.config.js`, move `eslintPluginPrettier` above the main config block so the local `"prettier/prettier": "warn"` override actually wins. Formatting drift then reports as a warning and can never break CI again.
2. Run `bunx prettier --write .` once to clear the current 2,033 formatting differences. This touches whitespace, quotes, and line wraps only — no behavior changes.
3. Verify `bun run lint` exits 0, and run a typecheck to confirm the format pass disturbed nothing.

## Out of scope

No changes to CI workflow, dependencies, `.prettierrc`, or app logic. The existing warnings (`react-hooks/exhaustive-deps`, `no-explicit-any`) stay as warnings — visible, not blocking.

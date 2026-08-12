# Fix CI lockfile drift and keep Dependabot on Bun

## What's happening

CI installs with `bun install --frozen-lockfile`, so `bun.lock` must exactly match `package.json`. Dependabot is configured with the `npm` ecosystem, so its "Bump esbuild and vite" PR updated `package.json` + `package-lock.json` but left `bun.lock` untouched. Bun sees the drift and refuses to install.

One important detail: Lovable is now connected to the **main** branch, but the CI workflow and Dependabot are both still pinned to **dev** (`branches: ["dev"]`, `target-branch: "dev"`). Any fix made here lands on main, so unless CI/Dependabot are retargeted, the failing dev build won't be fixed by this change alone.

## Plan

1. **Regenerate `bun.lock`** — run `bun install` (no `--frozen-lockfile`) so the lockfile matches the current `package.json` (vite `^7.3.6`, esbuild resolving to `0.28.1`), then commit the updated `bun.lock`.
2. **Point Dependabot at Bun** — change `.github/dependabot.yml` to `package-ecosystem: "bun"` so future bumps update `bun.lock` instead of `package-lock.json`.
3. **Remove `package-lock.json`** — the project builds with Bun only; keeping a second lockfile is what created this drift. Deleting it also stops npm-format bumps from reappearing.
4. **Retarget CI and Dependabot to `main`** — update `branches: ["dev"]` in `.github/workflows/node.js.yml` and `target-branch: "dev"` in `.github/dependabot.yml` to `main`, matching where Lovable now commits and publishes from.
5. **Verify** — run `bun install --frozen-lockfile`, `bun run lint`, and `bun run build` locally to confirm the exact CI sequence passes before committing.

## Notes

- The existing Dependabot PR #22 targets dev and can be closed once main is the tracked branch; its version bumps are already reflected in `package.json`.
- `bunfig.toml` keeps its 7-day supply-chain delay; regenerating the lockfile does not change that policy.
- If you'd rather keep CI on `dev`, skip step 4 and merge main into dev after the lockfile fix — say the word and I'll adjust.

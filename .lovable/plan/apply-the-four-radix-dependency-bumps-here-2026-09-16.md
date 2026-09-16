# Apply the four Radix dependency bumps here

Merging one update request at a time on GitHub causes conflicts because every one of
them edits the same two files (the dependency list and the lock file). Applying all
four in this project at once avoids the conflict entirely — the update requests then
become no-ops you can close.

## Current state

The slot bump (#48) is already present here at 1.3.3, so three remain:

| Package | Now | Target |
| --- | --- | --- |
| @radix-ui/react-slot | 1.3.3 | already done |
| @radix-ui/react-collapsible | 1.1.12 | 1.1.20 |
| @radix-ui/react-aspect-ratio | 1.1.8 | 1.1.15 |
| @radix-ui/react-progress | 1.1.8 | 1.1.16 |

All three are same-major, backwards-compatible updates.

## What I'll do

1. Install the three newer versions, which updates the dependency list and lock file
   together in one consistent pass.
2. Run the type check, the linter, and a full build to confirm nothing broke.
3. Click through the affected UI in the preview: an expanding/collapsing panel (the
   folder-stack competition results and the getting-started bubble), a progress bar,
   and a couple of buttons and sheets that sit on the shared slot primitive.
4. Report what passed, and flag anything that needs your eyes.

## After that

On GitHub, close #49, #50 and #51 with a note that the bumps landed directly. Vite 8
(#47) stays on hold as agreed.

## Technical notes

- `bun add` for the three packages, which rewrites `package.json` and `bun.lock` in a
  single resolution pass rather than three conflicting ones.
- Verification: `bunx tsgo --noEmit`, `bun run lint`, `bun run build`.
- No source-file changes are expected; if a type signature shifted, I'll fix the call
  site and say so.

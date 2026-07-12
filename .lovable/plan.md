Remove the "Beta invite code" section from the admin dashboard.

- `src/routes/_authenticated/admin.index.tsx`: delete the `overview?.betaInviteCode && <section>…</section>` block (lines 123–137).
- `src/lib/admin.functions.ts`: drop the `betaInviteCode` field from the overview server function's return (line 176) so it stops reading `process.env.BETA_INVITE_CODE`.

Leaving untouched (different concepts, not part of the beta code UI):
- The parent "Beta (no coach)" stat + `beta-signups` list — that's a real segment (parents without a coach), not beta-program plumbing.
- The "Gradus is in beta" wording on the feedback FAB — separate copy change; ask separately if you also want that reworded.

Add `SET search_path = public, pgmq` to the 4 `SECURITY DEFINER` pgmq wrapper functions that currently inherit the caller's search_path. This silences the Supabase linter warning and hardens against search_path hijacking with zero behavior or performance change.

## Functions updated

- `public.read_email_batch(text, integer, integer)`
- `public.delete_email(text, bigint)`
- `public.enqueue_email(text, jsonb)`
- `public.move_to_dlq(text, text, bigint, jsonb)`

## Technical details

Single migration that runs `CREATE OR REPLACE FUNCTION` for each of the 4 functions. Bodies are identical to today — only the function-level setting `SET search_path = public, pgmq` is added. `pgmq` is included so the extension's internal unqualified references continue to resolve.

No table changes, no policy changes, no code changes in the app. The email queue (`process.ts`, `webhook.ts`, `preview.ts`) calls these via RPC by name and signature, both of which are unchanged.

## Verification

After approval and apply, re-run the security scan — the `SUPA_function_search_path_mutable` warning should clear (the only remaining flagged functions today are these 4).

## What gets built

**Route** `src/routes/_authenticated/admin.ask.tsx` — question textarea, Ask
button, example-question chips, collapsible SQL editor with Run, results table,
Export CSV (reuses `src/lib/csv.ts`), and a saved-questions list stored in
localStorage. Existing components only (Card, Button, Textarea, Table, Sheet,
Eyebrow) and semantic tokens.

**Sidebar** — add `{ to: "/admin/ask", label: "Ask the data", icon: Sparkles }`
to the Reporting group in `src/components/admin/admin-sidebar.tsx`.

**Server** `src/lib/admin-ask.functions.ts`, two admin-gated server functions
(same `assertAdmin` pattern as `admin.functions.ts`):

- `askData({ question })` — builds a compact schema summary (table + column
  names for the public tables, plus notes: durations live in
  `plan_sessions.duration_seconds`, test rows are flagged `is_test`), sends it
  to the Lovable AI gateway (`createLovableAiGatewayProvider`,
  `google/gemini-2.5-flash`) with instructions to return exactly one read-only
  `SELECT`, then runs it through the same guard as below and returns
  `{ sql, columns, rows, rowCount, note }`.
- `runReadOnlySql({ sql })` — the editable-SQL path; identical guard + execute.

**Guard (server side, before execution)**
- exactly one statement, no trailing semicolon content
- must start with `select` or `with`
- reject any of `insert update delete drop alter create grant revoke truncate
  copy call do vacuum set security` as keywords, plus `pg_read_file`,
  `pg_sleep`, `dblink`
- wrap as `select * from (<sql>) q limit 500`

**Execution** requires a new database function, since the Data API can't run ad
hoc SQL:
`public.admin_run_readonly_sql(_sql text) returns jsonb`, `security definer`,
`set search_path = public`, which asserts `has_role(auth.uid(),'admin')`, sets
`transaction_read_only = on` and `statement_timeout = '8s'` locally, then
`execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', _sql)`.
Granted `execute` to `authenticated` only. Staged as an additive migration under
this draft — it becomes live when the draft is accepted, so the page can't be
exercised end-to-end until then.

Auth checks are doubled deliberately: the server function verifies admin, and
the SQL function verifies admin again so the RPC isn't callable directly by a
signed-in non-admin.

## Not in scope

No write queries, no schema changes from the tool, no scheduled/saved reports on
the server (saved questions are per-browser), no charts — table + CSV only.

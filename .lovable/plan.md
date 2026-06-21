## Plan: Ignore "Extension in Public" finding

### What I'll do
1. **Mark the finding as ignored** in the security scanner (`SUPA_extension_in_public`) with an explanation of why it's not applicable for this app.
2. **Update the security memory** to note that this warning is intentionally accepted, so future scans and AI sessions don't re-flag it as actionable.

### Rationale recorded
- The flagged extension (most likely `citext`) is embedded in the `admin_allowlist.email` column type. Moving it would require dropping and recreating that column and its dependent trigger (`grant_admin_if_allowlisted`).
- `pgmq` is already namespaced to its own `pgmq` schema (functions call `pgmq.send(...)` qualified), so it's not the offender.
- The warning is hygiene-level (namespace cleanliness), not an exploitable vulnerability. RLS, role grants, and auth paths are unaffected by extension schema location.
- Cost of fixing (migration risk to admin allowlist) outweighs benefit (silencing a lint warning).

### No database changes
No migrations, no code edits. This is purely scanner state + memory hygiene.
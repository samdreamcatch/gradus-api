## Security fixes plan

### 1. Add ownership check to plan activation
In `src/lib/plans.functions.ts`, `setPlanStatus` calls `activate_plan` RPC without first verifying the plan belongs to the current coach. Add an explicit `coach_id` ownership check before the RPC call, matching the pattern used in the benching path.

### 2. Add SELECT policy for `seed_moves`
`seed_moves` has RLS enabled but no policies, so reads silently fail. The `listMoves` server function reads it for curriculum categories. Add a migration with a permissive SELECT policy for authenticated users (it's curated seed content, not user data).

### 3. Address other RLS-enabled-but-no-policy tables
Three other tables have RLS on with no policies (`athlete_otp_challenges`, `invite_lookup_attempts`, and one more from the scan). These are intentionally locked down — only the service role should touch them via server functions. Confirm by reading the scan, then either:
- Leave as-is and mark the findings as ignored with an explanation (server-only via `supabaseAdmin`), OR
- Add an explicit `USING (false)` policy to make intent clear.

I'll go with the explicit `USING (false)` deny-all policy approach for clarity.

### 4. Review SECURITY DEFINER functions
Audit `activate_plan`, `seed_coach_library`, `coach_has_rostered_athlete_of_parent`, `is_parent_of_athlete`. Each already does `auth.uid()` checks internally or is a read-only helper used in RLS policies. Mark these findings as ignored with explanations rather than restricting EXECUTE (the RLS helpers need to be callable by authenticated/anon for policies to evaluate).

### 5. Ignore "parent links coach" finding + document guardian model
The parent is the legal guardian of a minor athlete and is explicitly trusted to link the athlete to any coach. Mark the finding ignored and update security memory to document this trust model so future scans don't re-flag it.

### 6. Skip leaked-password setting
Per your instruction, leaving this alone for now.

---

### Technical details

**Migration:**
```sql
-- Allow authenticated coaches to read curriculum seeds
CREATE POLICY "Seed moves readable by authenticated"
  ON public.seed_moves FOR SELECT TO authenticated USING (true);

-- Make deny-all explicit on server-only tables
CREATE POLICY "Deny all" ON public.athlete_otp_challenges
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Deny all" ON public.invite_lookup_attempts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
```

**Code change in `setPlanStatus` (activate branch):**
```ts
if (data.status === "active") {
  const { data: owned, error: ownErr } = await supabase
    .from("plans").select("id").eq("id", data.id).eq("coach_id", coachId).maybeSingle();
  if (ownErr) throw new Error(ownErr.message);
  if (!owned) throw new Error("Plan not found");
  const { error } = await supabase.rpc("activate_plan", { _plan_id: data.id });
  if (error) throw new Error(error.message);
}
```

**Security memory update:** add a section explaining that parents are guardians of minor athletes and are authorized to create `coach_athletes` links without coach confirmation; SECURITY DEFINER helpers used by RLS need broad EXECUTE; the listed deny-all tables are server-only.

**Findings to mark ignored:** parent-links-coach link, 4 SECURITY DEFINER function findings, and the deny-all table findings once policies are in place (mark fixed for those).

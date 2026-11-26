import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261125120000_practice_log_read_policies.sql. The old read
 * policies on plan_sessions queried tables that have policies of their own,
 * so one practice-log read expanded into about 170 subplans. The new rule
 * reads the caller's ids from SECURITY DEFINER functions. That every user
 * sees exactly the same rows was checked on a Postgres 16 replay of every
 * migration (see the PR); these checks read SQL as text, so the statements
 * that decide who sees what are compared word for word.
 */
const FIX = "20261125120000_practice_log_read_policies.sql";
const dir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
/** Lovable's own record of what it applied; numbered, not dated. */
const appliedDir = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
/** The last one from before this fix. */
const LAST_APPLIED_BEFORE_FIX = "0054_cron_history_cleanup.sql";
const flat = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const read = (file: string, from = dir) => flat(readFileSync(`${from}/${file}`, "utf8"));
const sqlFiles = (from: string) => readdirSync(from).filter((f) => f.endsWith(".sql"));
const fn = (name: string, body: string) =>
  `CREATE OR REPLACE FUNCTION public.${name}() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ ${body} $$;`;
const drop = (name: string) => `DROP POLICY IF EXISTS "${name}" ON public.plan_sessions;`;

const EXPECTED = [
  fn(
    "my_coach_plan_ids",
    "SELECT p.id FROM public.plans p JOIN public.coach_profiles cp ON cp.id = p.coach_id WHERE cp.user_id = (SELECT auth.uid());",
  ),
  fn(
    "my_practice_log_athlete_ids",
    "SELECT a.id FROM public.athletes a WHERE a.user_id = (SELECT auth.uid()) UNION SELECT a.id FROM public.athletes a JOIN public.parent_profiles pp ON pp.id = a.parent_id WHERE pp.user_id = (SELECT auth.uid());",
  ),
  "GRANT EXECUTE ON FUNCTION public.my_coach_plan_ids() TO authenticated, service_role;",
  "GRANT EXECUTE ON FUNCTION public.my_practice_log_athlete_ids() TO authenticated, service_role;",
  "REVOKE EXECUTE ON FUNCTION public.my_coach_plan_ids() FROM PUBLIC, anon;",
  "REVOKE EXECUTE ON FUNCTION public.my_practice_log_athlete_ids() FROM PUBLIC, anon;",
  drop("View practice log"),
  'CREATE POLICY "View practice log" ON public.plan_sessions FOR SELECT TO authenticated USING ( athlete_id IN (SELECT public.my_practice_log_athlete_ids()) OR plan_id IN (SELECT public.my_coach_plan_ids()) OR public.shares_athlete_window(athlete_id) );',
  drop("Coaches view sessions for own plans"),
  drop("Athletes view sessions for own plans"),
  drop("Parents view sessions for own athletes"),
  drop("Linked coaches view shared practice log"),
].join(" ");

/**
 * What a later migration may not do to who reads the practice log without
 * changing this test. It reads SQL as text, so it catches the ordinary ways,
 * not every way; a change it flags needs a person to look at it.
 */
const NAME = String.raw`(?:"(?:[^"]|"")*"|\w+)`;
const on = (tables: string) => String.raw`(?:"?public"?\s*\.\s*)?"?(?:${tables})"?(?![\w"])`;
const TABLE = on("plan_sessions");
/** The policy calls these; the two sets, and the linked-coach check it keeps. */
const TRUSTED = "my_coach_plan_ids|my_practice_log_athlete_ids|shares_athlete_window";
const match = (pattern: string, sql: string) => new RegExp(pattern, "i").test(sql);

function reopens(sql: string): string[] {
  const found: string[] = [];
  for (const statement of sql.split(";")) {
    const policy = statement.match(
      new RegExp(
        String.raw`\b(CREATE|ALTER|DROP) POLICY (?:IF EXISTS )?${NAME} ON ${TABLE}(.*)$`,
        "i",
      ),
    );
    if (policy) {
      const [, verb, rest] = policy;
      const writes = /^\s*(AS \w+ )?FOR (INSERT|DELETE|UPDATE)\b/i.test(rest!);
      if (verb!.toUpperCase() === "ALTER" || (verb!.toUpperCase() === "CREATE" && !writes))
        found.push(`${verb} POLICY on plan_sessions`);
      if (verb!.toUpperCase() === "DROP" && /"View practice log"/i.test(statement))
        found.push("drops the practice log's read policy");
    }
    // The sets are read without these tables' own policies, so a new limit on them has to go into the functions too.
    if (
      match(
        String.raw`\bCREATE POLICY ${NAME} ON ${on("plans|athletes|coach_profiles|parent_profiles")} AS RESTRICTIVE\b`,
        statement,
      )
    )
      found.push("limits a table the practice log's sets read past");
    if (
      match(
        String.raw`\b(CREATE|ALTER)\b[^(]*\bFUNCTION\b[^(]*\b(${TRUSTED})\b|\bDROP FUNCTION\b.*\b(${TRUSTED})\b`,
        statement,
      )
    )
      found.push("changes a function the practice log's read policy trusts");
    if (
      match(String.raw`\bALTER TABLE (IF EXISTS )?(ONLY )?${TABLE}.*\bDISABLE ROW LEVEL`, statement)
    )
      found.push("turns row security off");
    if (
      match(
        String.raw`\bGRANT\b.*(\b(my_coach_plan_ids|my_practice_log_athlete_ids)\b|\bALL (FUNCTIONS|ROUTINES) IN SCHEMA\b.*\bpublic\b).*\bTO\b.*\b(anon|PUBLIC)\b`,
        statement,
      )
    )
      found.push("opens a function to signed-out callers");
    if (
      match(
        String.raw`\bREVOKE\b.*(\b(${TRUSTED})\b|\bALL (FUNCTIONS|ROUTINES) IN SCHEMA\b.*\bpublic\b).*\bFROM\b.*\bauthenticated\b`,
        statement,
      )
    )
      found.push("closes a function signed-in readers need");
  }
  return found;
}

/** Migrations from before the fix that touch these; the fix runs after them. */
const SETTLED_BY_THE_FIX = new Set([
  "20260531203221_c8fc7ed4-9ed8-4a15-bacc-b930da25d405.sql",
  "20260601013921_5f03af5a-a062-4aec-a20a-3472c9ef4cbe.sql",
  "20260821231105_17f2d85e-72c8-481b-afce-fa31eeb8d99a.sql",
  "20260821233614_dc88a490-f553-4f3c-8f5f-6fad4d6577ba.sql",
  "20260927120000_coach_visibility_rules.sql",
]);

describe(FIX, () => {
  it("is exactly the reviewed statements, and nothing else", () => {
    expect(read(FIX)).toBe(EXPECTED);
  });

  it("is not undone by another migration, whatever its date", () => {
    for (const file of sqlFiles(dir).filter((f) => f !== FIX && !SETTLED_BY_THE_FIX.has(f))) {
      expect({ file, found: reopens(read(file)) }).toEqual({ file, found: [] });
    }
  });

  it("is not undone by what Lovable applied after it", () => {
    for (const file of sqlFiles(appliedDir).filter((f) => f > LAST_APPLIED_BEFORE_FIX)) {
      const sql = read(file, appliedDir);
      // Its copy of this fix, if word for word the same.
      if (sql === EXPECTED) continue;
      expect({ file, found: reopens(sql) }).toEqual({ file, found: [] });
    }
  });
});

describe("the later-migration check", () => {
  for (const sql of [
    'CREATE POLICY "x" ON public.plan_sessions FOR SELECT TO authenticated USING (true);',
    "CREATE POLICY x ON plan_sessions USING (true);",
    'CREATE POLICY "x" ON public.plan_sessions AS PERMISSIVE FOR SELECT USING (true);',
    'CREATE POLICY "x" ON "public"."plan_sessions" FOR ALL USING (true);',
    'ALTER POLICY "View practice log" ON public.plan_sessions USING (true);',
    "CREATE OR REPLACE FUNCTION public.my_coach_plan_ids() RETURNS SETOF uuid AS $$ SELECT id FROM plans $$;",
    "DROP FUNCTION IF EXISTS public.my_practice_log_athlete_ids();",
    "ALTER TABLE public.plan_sessions DISABLE ROW LEVEL SECURITY;",
    "GRANT EXECUTE ON FUNCTION public.my_coach_plan_ids() TO authenticated, anon;",
    "ALTER TABLE IF EXISTS public.plan_sessions DISABLE ROW LEVEL SECURITY;",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    'DROP POLICY "View practice log" ON public.plan_sessions;',
    "REVOKE EXECUTE ON FUNCTION public.my_coach_plan_ids() FROM authenticated;",
    "CREATE OR REPLACE FUNCTION public.shares_athlete_window(a uuid) RETURNS boolean AS $$ SELECT true $$;",
    'CREATE POLICY "a ""b""" ON public.plan_sessions USING (true);',
    "DROP FUNCTION public.other(uuid), public.my_coach_plan_ids();",
    'CREATE POLICY "x" ON public.plans AS RESTRICTIVE FOR SELECT USING (false);',
  ]) {
    it(`flags ${sql}`, () => {
      expect(reopens(flat(sql))).not.toEqual([]);
    });
  }

  for (const sql of [
    'CREATE POLICY "x" ON public.plan_sessions FOR INSERT TO authenticated WITH CHECK (true);',
    'CREATE POLICY "x" ON public.plan_session_move_ratings FOR SELECT USING (true);',
    "SELECT public.my_coach_plan_ids();",
    "CREATE FUNCTION public.f(a uuid) RETURNS boolean AS $$ SELECT public.shares_athlete_window(a) $$;",
    'CREATE POLICY "x" ON public.plans FOR SELECT USING (true);',
    'DROP POLICY "Parents delete sessions for own athletes" ON public.plan_sessions;',
  ]) {
    it(`leaves ${sql} alone`, () => {
      expect(reopens(flat(sql))).toEqual([]);
    });
  }
});

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261121120000_security_recheck_lookups_and_test_flag.sql.
 * Invite-code lookups and the yes/no lookups about other people are closed
 * to callers who do not need them, and a member cannot mark their own
 * profile as a test account. The behaviour was checked on a Postgres 16
 * replay of the migrations (see PR #301). These checks read SQL as text, so
 * they catch the ordinary ways a later migration reopens something, not
 * every way; a change they flag needs a person to look at it.
 *
 * What runs in production is Lovable's applied copy (APPLIED_COPY), so the
 * checks of what the fix does read that file. Lovable applied it twice: first
 * without taking is_any_org_admin away from signed-in members (PARTIAL_COPY,
 * 2026-11-22), then the whole saved migration (2026-11-25).
 */

const FIX_MIGRATION = "20261121120000_security_recheck_lookups_and_test_flag.sql";
/** Lovable's applied record is numbered. Its copies of the fix came after this file, so anything from this number up, except this file and those copies, is "later". */
const LAST_APPLIED_BEFORE_FIX = "0050_rls_audit_hardening.sql";
/** Lovable's first applied copy, which left is_any_org_admin open to members. APPLIED_COPY ran after it and settles everything it touched. */
const PARTIAL_COPY = "0052_security_recheck_lookups_and_test_flag.sql";
/** Lovable's applied copy of the whole fix: what production actually ran last. */
const APPLIED_COPY = "0053_security_recheck_lookups_and_test_flag_complete.sql";

/** The only statements where PARTIAL_COPY differs from the saved migration: applied form → saved form. */
const PARTIAL_DIFFERENCES: Record<string, string> = {
  "GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO authenticated, service_role":
    "GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO service_role",
  "REVOKE EXECUTE ON FUNCTION public.is_any_org_admin(uuid) FROM PUBLIC, anon":
    "REVOKE EXECUTE ON FUNCTION public.is_any_org_admin(uuid) FROM PUBLIC, anon, authenticated",
};

/**
 * Migrations from before the fix that define, drop or grant these functions
 * (or the function the test-flag guard trusts). The
 * fix runs after them, so they are not checked. Every other migration is,
 * whatever its timestamp: a file added later with an earlier date is still
 * applied after the fix.
 */
const SETTLED_BY_THE_FIX = new Set([
  "20260613023806_9a71e7e5-62bb-48df-af11-1075076ffdbf.sql",
  "20260621024729_93e809cc-6dfe-4365-a440-32b39c00ba29.sql",
  "20260711224005_e95424e9-15c6-4161-89ca-1cba07318b25.sql",
  "20260717125244_e63b323d-20aa-4c44-9966-b2303c7b06eb.sql",
  "20260719231519_566728b7-8f1a-4337-bb3d-a66b7af46394.sql",
  "20260821233614_dc88a490-f553-4f3c-8f5f-6fad4d6577ba.sql",
  "20260831000357_0adf8aca-8d9d-4579-8f07-222895f2543a.sql",
  "20260905200000_protect_billing_columns.sql",
  "20260905201330_984e48e2-a471-4256-91fb-134ea0af9e08.sql",
  "20260927120000_coach_visibility_rules.sql",
]);

/** Only the server calls these. */
const SERVER_ONLY = [
  "get_parent_by_invite_code",
  "get_adult_athlete_by_invite_code",
  "users_blocked",
  "is_any_org_admin",
  "coaches_linked_for_athlete",
  "team_plan_active",
];

/** Row-level policies call these as the signed-in member; signed-out callers have no use for them. */
const MEMBERS_ONLY = ["has_role", "has_org_admin", "is_direct_room_participant"];

/** The test-flag trigger function, and the function it trusts to tell the server from a member. */
const GUARD_FUNCTIONS = ["protect_profile_test_flag", "is_service_caller"];

/** Roles that already bypass grants or are the server. */
const SERVER_ROLES = ["service_role", "postgres", "supabase_admin"];

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const supabaseDir = root("supabase/migrations");
const drizzleDir = root("drizzle/migrations");
const sqlFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

/** SQL with comments dropped, split on semicolons, whitespace collapsed. Function bodies split too, which is fine here. */
function statements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** `fn` as a whole name: not `athlete_team_plan_active` for `team_plan_active`. */
const names = (stmt: string, fn: string) => new RegExp(`(?<![\\w])${fn}(?![\\w])`, "i").test(stmt);

/** Role names after the last TO or FROM of a GRANT or REVOKE, lower-cased, quotes dropped. */
function roles(stmt: string, keyword: "TO" | "FROM"): string[] {
  const at = stmt.toUpperCase().lastIndexOf(` ${keyword} `);
  if (at < 0) return [];
  return stmt
    .slice(at + keyword.length + 2)
    .replace(/\b(with grant option|granted by .*|cascade|restrict)\b/gi, "")
    .split(",")
    .map((role) => role.replace(/["'$)\s]/g, "").toLowerCase())
    .filter(Boolean);
}

/** `CREATE [OR REPLACE] | DROP | ALTER FUNCTION fn`: the statement is about `fn` itself, not one that merely calls it. */
const definitionOf = (stmt: string, fn: string, verbs: string) =>
  new RegExp(
    `\\b(${verbs})\\s+(FUNCTION|ROUTINE)\\s+(IF\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?${fn}"?(?![\\w])`,
    "i",
  ).test(stmt);

/** An ALTER that matters here: a rename, a new owner, a new schema, or a change of SECURITY. Not `SET search_path`. */
const riskyAlter = (stmt: string, fn: string) =>
  definitionOf(stmt, fn, "ALTER") && /\b(RENAME|OWNER|SECURITY|SET\s+SCHEMA)\b/i.test(stmt);

/**
 * How many arguments the list after `fn` has in a CREATE or REVOKE, or null
 * when there is no list. Commas inside brackets (`numeric(10, 2)`, defaults)
 * do not count.
 */
function argCount(stmt: string, fn: string): number | null {
  const at = stmt.search(new RegExp(`(?<![\\w])${fn}"?\\s*\\(`, "i"));
  if (at < 0) return null;
  let depth = 0;
  let commas = 0;
  let inside = "";
  for (const ch of stmt.slice(stmt.indexOf("(", at))) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 1) commas += 1;
    if (depth === 0) break;
    if (depth >= 1 && !(depth === 1 && ch === "(")) inside += ch;
  }
  return inside.trim() === "" ? 0 : commas + 1;
}

/**
 * Why a statement from a later migration would reopen something, or null.
 * `rest` is the statements after it in the same file: re-creating a function
 * is fine when the file closes it again afterwards.
 */
function problem(stmt: string, rest: string[]): string | null {
  if (
    /\bGRANT\b.*\bON ALL (FUNCTIONS|ROUTINES) IN SCHEMA\b.*\bpublic\b.*\bTO\b/i.test(stmt) &&
    roles(stmt, "TO").some((role) => !SERVER_ROLES.includes(role))
  ) {
    return "grants every function in the schema to a client role";
  }
  if (/\b(DROP|ALTER)\s+TRIGGER\b.*protect_test_flag_on_/i.test(stmt)) {
    return "drops or alters the test-flag trigger";
  }
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\s+"?protect_test_flag_on_/i.test(stmt)) {
    return "re-creates the test-flag trigger (it must stay BEFORE INSERT OR UPDATE)";
  }
  // Switching off one named trigger for a backfill is ordinary; switching off
  // this one, or all of them, on a profile table is not.
  if (
    /\bDISABLE\s+TRIGGER\s+(ALL\b|USER\b|"?protect_test_flag_on_)/i.test(stmt) &&
    /\b(coach|parent)_profiles\b/i.test(stmt)
  ) {
    return "disables the test-flag trigger on a profile table";
  }
  for (const fn of GUARD_FUNCTIONS) {
    if (definitionOf(stmt, fn, "CREATE(?:\\s+OR\\s+REPLACE)?|DROP") || riskyAlter(stmt, fn)) {
      return `changes ${fn}, which the test-flag guard depends on`;
    }
  }
  for (const fn of [...SERVER_ONLY, ...MEMBERS_ONLY]) {
    if (!names(stmt, fn)) continue;
    const serverOnly = SERVER_ONLY.includes(fn);
    if (/\bGRANT\b/i.test(stmt)) {
      const opened = roles(stmt, "TO").filter((role) =>
        serverOnly ? !SERVER_ROLES.includes(role) : role === "anon" || role === "public",
      );
      if (opened.length) return `grants ${fn} to ${opened.join(", ")}`;
    }
    if (definitionOf(stmt, fn, "DROP") || riskyAlter(stmt, fn)) {
      return `drops or alters ${fn} (re-creating it resets its grants to the open defaults)`;
    }
    if (definitionOf(stmt, fn, "CREATE(?:\\s+OR\\s+REPLACE)?")) {
      // A different argument list is a second function that starts open, so
      // the revoke has to name the same number of arguments as the create.
      const mustLose = serverOnly ? ["public", "anon", "authenticated"] : ["public", "anon"];
      const created = argCount(stmt, fn);
      const closedAgain = rest.some(
        (later) =>
          /\bREVOKE\b/i.test(later) &&
          names(later, fn) &&
          argCount(later, fn) === created &&
          mustLose.every((role) => roles(later, "FROM").includes(role)),
      );
      if (!closedAgain) {
        return `creates or replaces ${fn} without revoking that same signature from ${mustLose.join(", ")} afterwards (a new argument list is a new function that starts open)`;
      }
    }
  }
  return null;
}

/** Every problem in a migration's SQL. */
function problems(sql: string): string[] {
  const all = statements(sql);
  return all.flatMap((stmt, i) => problem(stmt, all.slice(i + 1)) ?? []);
}

describe("lookup functions stay closed (migrations)", () => {
  const supabaseFiles = sqlFiles(supabaseDir);
  const drizzleFiles = sqlFiles(drizzleDir);
  const fixIndex = supabaseFiles.indexOf(FIX_MIGRATION);
  const appliedIndex = drizzleFiles.indexOf(APPLIED_COPY);
  const fixSql = appliedIndex >= 0 ? readFileSync(`${drizzleDir}/${APPLIED_COPY}`, "utf8") : "";
  const fix = statements(fixSql);
  const savedSql = fixIndex >= 0 ? readFileSync(`${supabaseDir}/${FIX_MIGRATION}`, "utf8") : "";

  it("applied copy matches the saved migration", () => {
    // Tests below only look for the statements they need, so anything else
    // added to either file (a grant, a dropped trigger) is caught here.
    expect(fix.length).toBeGreaterThan(0);
    expect(fix).toEqual(statements(savedSql));
  });

  it("first applied copy holds nothing else that the complete copy would not settle", () => {
    const partial = statements(readFileSync(`${drizzleDir}/${PARTIAL_COPY}`, "utf8"));
    expect(partial.map((s) => PARTIAL_DIFFERENCES[s] ?? s)).toEqual(statements(savedSql));
  });

  it("closes the server-only lookups to members and signed-out callers", () => {
    expect(fixIndex).toBeGreaterThanOrEqual(0);
    expect(appliedIndex).toBeGreaterThanOrEqual(0);
    for (const fn of SERVER_ONLY) {
      const revoke = fix.find((s) => s.startsWith(`REVOKE EXECUTE ON FUNCTION public.${fn}(`));
      expect(revoke).toBeDefined();
      expect(roles(revoke ?? "", "FROM")).toEqual(["public", "anon", "authenticated"]);
    }
  });

  it("closes the policy helpers to signed-out callers only", () => {
    for (const fn of MEMBERS_ONLY) {
      const revoke = fix.find((s) => s.startsWith(`REVOKE EXECUTE ON FUNCTION public.${fn}(`));
      expect(revoke).toBeDefined();
      expect(roles(revoke ?? "", "FROM")).toEqual(["public", "anon"]);
      const grant = fix.find((s) => s.startsWith(`GRANT EXECUTE ON FUNCTION public.${fn}(`));
      expect(roles(grant ?? "", "TO")).toEqual(["authenticated", "service_role"]);
    }
  });

  it("no other migration hands them back or removes the test-flag guard", () => {
    const later: Array<[string, string]> = supabaseFiles
      .filter((file) => file !== FIX_MIGRATION && !SETTLED_BY_THE_FIX.has(file))
      .map((file) => [`supabase/migrations/${file}`, `${supabaseDir}/${file}`]);
    for (const file of drizzleFiles) {
      const number = Number.parseInt(file, 10);
      if (
        file !== LAST_APPLIED_BEFORE_FIX &&
        file !== PARTIAL_COPY &&
        file !== APPLIED_COPY &&
        // A file without a leading number could have been added at any time.
        (Number.isNaN(number) || number >= Number.parseInt(LAST_APPLIED_BEFORE_FIX, 10))
      ) {
        later.push([`drizzle/migrations/${file}`, `${drizzleDir}/${file}`]);
      }
    }
    const offenders: string[] = [];
    for (const [label, path] of later) {
      const sql = readFileSync(path, "utf8");
      for (const why of problems(sql)) offenders.push(`${label}: ${why}`);
    }
    // Call these from the server with the admin client instead of reopening
    // them. If the change is deliberate and safe, update this guard with it.
    expect(offenders).toEqual([]);
  });

  it("blocks a member from marking a profile as a test account", () => {
    expect(fixSql).toContain("IF NEW.is_test IS TRUE THEN");
    // An edit after sign-up is the same hole as an insert.
    expect(fixSql).toContain("ELSIF NEW.is_test IS DISTINCT FROM OLD.is_test THEN");
    // A definer function sees the owner as current_user, so is_service_caller()
    // would pass for everyone: the trap the two older profile guards fell into.
    expect(fix.some((s) => /\bSECURITY DEFINER\b/i.test(s))).toBe(false);
    for (const table of ["coach_profiles", "parent_profiles"]) {
      expect(
        fix.some(
          (s) =>
            s.startsWith("CREATE TRIGGER protect_test_flag_on_") &&
            s.includes(`BEFORE INSERT OR UPDATE ON public.${table} `) &&
            s.endsWith("EXECUTE FUNCTION public.protect_profile_test_flag()"),
        ),
      ).toBe(true);
    }
  });

  it("flags the ways a later migration could reopen them", () => {
    const flagged = (sql: string) => problems(sql).length > 0;
    // Plain, quoted, commented and bundled grants.
    expect(
      flagged("GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;"),
    ).toBe(true);
    expect(
      flagged('GRANT ALL ON FUNCTION "public"."users_blocked"(uuid, uuid) TO authenticated, anon;'),
    ).toBe(true);
    expect(
      flagged("/* note */ GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO anon;"),
    ).toBe(true);
    expect(
      flagged(
        "GRANT EXECUTE ON FUNCTION public.is_room_participant(uuid), public.users_blocked(uuid, uuid) TO authenticated;",
      ),
    ).toBe(true);
    expect(flagged("GRANT EXECUTE ON FUNCTION public.team_plan_active TO authenticated;")).toBe(
      true,
    );
    expect(
      flagged(
        "GRANT EXECUTE ON ROUTINE public.coaches_linked_for_athlete(uuid, uuid, uuid) TO authenticated;",
      ),
    ).toBe(true);
    expect(flagged("GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO anon;")).toBe(true);
    expect(
      flagged(
        "GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO authenticated, service_role;",
      ),
    ).toBe(true);
    expect(
      flagged('GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO "anon";'),
    ).toBe(true);
    expect(flagged("grant execute on function public.has_org_admin(uuid, uuid) to public;")).toBe(
      true,
    );
    expect(
      flagged(
        "DO $$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO anon'; END $$;",
      ),
    ).toBe(true);
    expect(flagged("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;")).toBe(
      true,
    );
    // Dropping, or re-creating without closing again (a new overload starts open).
    expect(flagged("DROP FUNCTION IF EXISTS public.users_blocked(uuid, uuid);")).toBe(true);
    expect(flagged("DROP FUNCTION public.users_blocked;")).toBe(true);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.users_blocked(a uuid, b uuid, c boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
      ),
    ).toBe(true);
    expect(
      flagged(
        "CREATE FUNCTION public.has_role(_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
      ),
    ).toBe(true);
    // The test-flag guard.
    expect(
      flagged("DROP TRIGGER protect_test_flag_on_coach_profiles ON public.coach_profiles;"),
    ).toBe(true);
    expect(flagged("ALTER TABLE public.parent_profiles DISABLE TRIGGER USER;")).toBe(true);
    expect(
      flagged(
        "ALTER TABLE public.coach_profiles DISABLE TRIGGER protect_test_flag_on_coach_profiles;",
      ),
    ).toBe(true);
    expect(
      flagged(
        "CREATE OR REPLACE TRIGGER protect_test_flag_on_coach_profiles BEFORE UPDATE OF first_name ON public.coach_profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_test_flag();",
      ),
    ).toBe(true);
    expect(flagged("ALTER FUNCTION public.protect_profile_test_flag() SECURITY DEFINER;")).toBe(
      true,
    );
    expect(flagged("ALTER FUNCTION public.users_blocked(uuid, uuid) OWNER TO authenticated;")).toBe(
      true,
    );
    // Adding a parameter makes a second function; a revoke copied from the fix names the old one.
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.users_blocked(a uuid, b uuid, strict boolean DEFAULT false) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; REVOKE EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;",
      ),
    ).toBe(true);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.protect_profile_test_flag() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;",
      ),
    ).toBe(true);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.is_service_caller() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
      ),
    ).toBe(true);

    // Harmless: other functions, server-side grants, revokes, policies that call the helpers.
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.protect_invoice_columns() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF public.is_service_caller() THEN RETURN NEW; END IF; RETURN NEW; END $$;",
      ),
    ).toBe(false);
    expect(
      flagged(
        "CREATE TRIGGER protect_test_flag_on_club_profiles BEFORE INSERT OR UPDATE ON public.club_profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_test_flag();",
      ),
    ).toBe(true);
    expect(
      flagged(
        "CREATE TRIGGER guard_other BEFORE INSERT OR UPDATE ON public.club_profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_test_flag();",
      ),
    ).toBe(false);
    expect(
      flagged("ALTER TABLE public.coach_profiles DISABLE TRIGGER trg_coach_profiles_updated_at;"),
    ).toBe(false);
    expect(
      flagged("ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;"),
    ).toBe(false);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.price(a numeric(10, 2), b text DEFAULT 'x') RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;",
      ),
    ).toBe(false);
    expect(flagged("GRANT EXECUTE ON FUNCTION public.has_role_x(uuid) TO anon;")).toBe(false);
    expect(
      flagged("GRANT EXECUTE ON FUNCTION public.athlete_team_plan_active(uuid) TO authenticated;"),
    ).toBe(false);
    expect(
      flagged("GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO service_role;"),
    ).toBe(false);
    expect(
      flagged("GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;"),
    ).toBe(false);
    expect(flagged("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;")).toBe(false);
    expect(
      flagged("REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;"),
    ).toBe(false);
    expect(
      flagged(
        "CREATE POLICY \"Admins read\" ON public.notes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));",
      ),
    ).toBe(false);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; REVOKE EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;",
      ),
    ).toBe(false);
    expect(
      flagged(
        "CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;",
      ),
    ).toBe(false);
  });
});

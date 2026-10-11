import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261010130000_athletes_update_policies_no_recursion.sql. A
 * policy on athletes that queries athletes makes every statement it applies
 * to fail with 42P17 (infinite recursion), which is how signed-in updates to
 * athletes broke. The column locks those subqueries enforced now live in the
 * protect_athlete_locked_columns trigger. The behaviour itself was checked on
 * a Postgres 16 replay of every migration (see the PR); these checks keep
 * later migrations from reintroducing the recursion or dropping the locks.
 */

const FIX_MIGRATION = "20261010130000_athletes_update_policies_no_recursion.sql";
const LOCKED = [
  "user_id",
  "parent_id",
  "self_managed",
  "is_test",
  "guardian_claimed_at",
  "guardian_claim_token",
  "guardian_claim_code",
  "account_state",
];

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const migrationsDir = root("supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (file: string) => readFileSync(`${migrationsDir}/${file}`, "utf8");

/**
 * SQL split into statements, comments dropped, whitespace collapsed. Quoted
 * strings, quoted identifiers and dollar-quoted bodies are kept whole, so a
 * function body's semicolons don't split it.
 */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    const quote = dollar ? dollar[0] : rest[0] === "'" || rest[0] === '"' ? rest[0] : null;
    if (quote) {
      const end = sql.indexOf(quote, i + quote.length);
      const stop = end === -1 ? sql.length : end + quote.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (rest[0] === ";") {
      out.push(current);
      current = "";
    } else {
      current += rest[0];
    }
    i += 1;
  }
  out.push(current);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Every policy on public.athletes after all migrations, by name. */
function livePolicies(): Map<string, { file: string; sql: string }> {
  const live = new Map<string, { file: string; sql: string }>();
  for (const file of migrations) {
    for (const stmt of statements(read(file))) {
      const m = stmt.match(
        /^(CREATE|DROP) POLICY (IF EXISTS )?"([^"]+)" ON (public\.)?athletes\b/i,
      );
      if (!m) continue;
      if (m[1].toUpperCase() === "DROP") live.delete(m[3]);
      else live.set(m[3], { file, sql: stmt });
    }
  }
  return live;
}

/** The last CREATE [OR REPLACE] FUNCTION public.<name> statement. */
function latestFunction(name: string): { file: string; sql: string } | null {
  let found: { file: string; sql: string } | null = null;
  const re = new RegExp(`^CREATE (OR REPLACE )?FUNCTION (public\\.)?${name}\\(`, "i");
  for (const file of migrations) {
    for (const stmt of statements(read(file))) {
      if (re.test(stmt)) found = { file, sql: stmt };
    }
  }
  return found;
}

describe("statements()", () => {
  it("keeps dollar-quoted bodies and quoted text whole", () => {
    const sql = `-- a; comment
      CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$;
      SELECT 'a;b', "x;y"; /* c; */ SELECT $tag$ ; $tag$`;
    expect(statements(sql)).toEqual([
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$",
      `SELECT 'a;b', "x;y"`,
      "SELECT $tag$ ; $tag$",
    ]);
  });
});

describe("athletes policies (42P17 recursion)", () => {
  const live = livePolicies();

  it("the fix migration exists", () => {
    expect(migrations).toContain(FIX_MIGRATION);
  });

  it("no live policy on athletes queries athletes", () => {
    const offenders = [...live]
      .filter(([, p]) => /\b(FROM|JOIN) (public\.)?"?athletes"?\b/i.test(p.sql))
      .map(([name, p]) => `${p.file}: ${name}`);
    expect(offenders).toEqual([]);
  });

  it("parents update only their own athletes", () => {
    const p = live.get("Parents can update own athletes");
    expect(p?.sql).toMatch(/FOR UPDATE TO authenticated USING/i);
    const checks = p?.sql.match(/pp\.id = athletes\.parent_id AND pp\.user_id = auth\.uid\(\)/g);
    expect(checks?.length).toBe(2); // USING and WITH CHECK
  });

  it("athletes update only their own row, and can read it", () => {
    expect(live.get("Athletes can update own row")?.sql).toMatch(
      /FOR UPDATE TO authenticated USING \(auth\.uid\(\) = user_id\) WITH CHECK \(auth\.uid\(\) = user_id\)$/i,
    );
    // Live in production since 20260527020340 (applied, then deleted from the repo).
    expect(live.get("Athletes can view own row")?.sql).toMatch(
      /FOR SELECT TO authenticated USING \(auth\.uid\(\) = user_id\)$/i,
    );
  });
});

describe("protect_athlete_locked_columns trigger", () => {
  const fn = latestFunction("protect_athlete_locked_columns");

  it("lets server roles through and locks every protected column for everyone else", () => {
    expect(fn).not.toBeNull();
    const sql = fn!.sql;
    // Must run as the caller: is_service_caller() reads current_user.
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/IF public\.is_service_caller\(\) THEN RETURN NEW; END IF;/);
    for (const col of LOCKED) {
      expect(sql).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
    expect(sql).toMatch(/ERRCODE = '42501'/);
  });

  it("is attached BEFORE UPDATE on athletes and never dropped afterwards", () => {
    let attached = false;
    for (const file of migrations) {
      for (const stmt of statements(read(file))) {
        if (
          /^CREATE TRIGGER protect_athlete_locked_columns BEFORE UPDATE ON public\.athletes FOR EACH ROW EXECUTE FUNCTION public\.protect_athlete_locked_columns\(\)$/i.test(
            stmt,
          )
        ) {
          attached = true;
        } else if (/^DROP TRIGGER (IF EXISTS )?protect_athlete_locked_columns\b/i.test(stmt)) {
          attached = false;
        }
      }
    }
    expect(attached).toBe(true);
  });
});

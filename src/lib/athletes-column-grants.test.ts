import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261010125000_hide_guardian_claim_tokens.sql. The guardian
 * claim token and code are claim credentials, so client roles (anon,
 * authenticated) read athletes column by column and never see those two.
 * These checks keep later migrations and RLS-client code from undoing that.
 */

const HIDDEN = ["guardian_claim_token", "guardian_claim_code"];
const HIDE_MIGRATION = "20261010125000_hide_guardian_claim_tokens.sql";

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const migrationsDir = root("supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (file: string) => readFileSync(`${migrationsDir}/${file}`, "utf8");

/** SQL without comments, split into statements, whitespace collapsed. */
function statements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const onAthletes = /\bON (TABLE )?(public\.)?"?athletes"?\b/i;
const toClientRole = /\bTO\b.*\b(anon|authenticated|public)\b/i;

/** Columns a statement grants SELECT on, or "table" for a table-wide grant. */
function selectGrant(stmt: string): string[] | "table" | null {
  if (!/^GRANT\b/i.test(stmt) || !toClientRole.test(stmt)) return null;
  if (/\bON ALL TABLES IN SCHEMA public\b/i.test(stmt)) {
    return /\b(ALL|SELECT)\b/i.test(stmt.split(/\bON\b/i)[0]) ? "table" : null;
  }
  if (!onAthletes.test(stmt)) return null;
  const privileges = stmt.split(/\bON\b/i)[0];
  if (/\bALL\b/i.test(privileges) && !/\bALL\s*\(/i.test(privileges)) return "table";
  const columns = privileges.match(/\bSELECT\s*\(([^)]*)\)/i);
  if (columns) return columns[1].split(",").map((c) => c.trim().replace(/"/g, ""));
  return /\bSELECT\b/i.test(privileges) ? "table" : null;
}

/** Columns an ALTER TABLE ... athletes statement adds. */
function addedColumns(stmt: string): string[] {
  if (!/^ALTER TABLE (IF EXISTS )?(ONLY )?(public\.)?"?athletes"? /i.test(stmt)) return [];
  return [...stmt.matchAll(/\bADD (COLUMN )?(IF NOT EXISTS )?"?([a-z_][a-z0-9_]*)"?/gi)]
    .map((m) => m[3])
    .filter((name) => !/^(constraint|primary|unique|foreign|check)$/i.test(name));
}

describe("athletes column grants (guardian claim credentials)", () => {
  const hideIndex = migrations.indexOf(HIDE_MIGRATION);
  const later = migrations.slice(hideIndex + 1);

  it("revokes table-level SELECT and re-grants every column but the two credentials", () => {
    expect(hideIndex).toBeGreaterThanOrEqual(0);
    const sql = statements(read(HIDE_MIGRATION)).join(";\n");
    expect(sql).toMatch(/REVOKE SELECT ON public\.athletes FROM anon, authenticated/i);
    expect(sql).toMatch(/attname NOT IN \('guardian_claim_token', 'guardian_claim_code'\)/);
    expect(sql).toMatch(/GRANT SELECT \(%s\) ON public\.athletes TO anon, authenticated/);
  });

  it("no later migration grants table-wide SELECT on athletes, or the credentials, to a client role", () => {
    const offenders: string[] = [];
    for (const file of later) {
      for (const stmt of statements(read(file))) {
        const grant = selectGrant(stmt);
        if (grant === "table" || (grant && grant.some((c) => HIDDEN.includes(c)))) {
          offenders.push(`${file}: ${stmt.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every column a later migration adds to athletes is granted SELECT in the same migration", () => {
    const missing: string[] = [];
    for (const file of later) {
      const stmts = statements(read(file));
      const granted = new Set(
        stmts.flatMap((s) => {
          const grant = selectGrant(s);
          return Array.isArray(grant) && /\banon\b/i.test(s) && /\bauthenticated\b/i.test(s)
            ? grant
            : [];
        }),
      );
      for (const column of stmts.flatMap(addedColumns)) {
        if (!HIDDEN.includes(column) && !granted.has(column)) missing.push(`${file}: ${column}`);
      }
    }
    // Fix: add `GRANT SELECT (<column>) ON public.athletes TO anon, authenticated;`
    // to the migration that adds the column (or leave it out on purpose and add
    // it to HIDDEN here, if no client may read it).
    expect(missing).toEqual([]);
  });

  it("parses the shapes it guards", () => {
    expect(selectGrant("GRANT ALL ON public.athletes TO authenticated")).toBe("table");
    expect(selectGrant("GRANT SELECT ON TABLE athletes TO anon")).toBe("table");
    expect(
      selectGrant("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO authenticated"),
    ).toBe("table");
    expect(
      selectGrant("GRANT SELECT (id, first_name) ON public.athletes TO anon, authenticated"),
    ).toEqual(["id", "first_name"]);
    expect(selectGrant("GRANT ALL ON public.athletes TO service_role")).toBeNull();
    expect(selectGrant("GRANT SELECT ON public.athlete_goals TO authenticated")).toBeNull();
    expect(
      addedColumns(
        "ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS nickname text, ADD COLUMN rink text, ADD CONSTRAINT x CHECK (true)",
      ),
    ).toEqual(["nickname", "rink"]);
    expect(addedColumns("ALTER TABLE public.athlete_goals ADD COLUMN note text")).toEqual([]);
  });
});

describe("RLS-client reads of athletes", () => {
  /** Every .ts/.tsx file under src/, tests and generated types excluded. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      if (path.endsWith("integrations/supabase/types.ts")) return [];
      return [path];
    });
  }

  it("never select * or read the claim credentials through a non-admin client", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root("src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:([\w.]+)\s*)?\.from\(\s*["'`]athletes["'`]\s*\)/g)) {
        // Service-role clients (admin, supabaseAdmin, ctx.admin) may do both.
        if (/admin/i.test(m[1] ?? "")) continue;
        const rest = src.slice(m.index! + m[0].length);
        const chain = rest.slice(0, rest.search(/;|\n\s*\n/) + 1 || 600);
        const line = src.slice(0, m.index).split("\n").length;
        const where = `${file.slice(file.indexOf("/src/") + 1)}:${line}`;
        if (/\.select\(\s*\)|\.select\(\s*["'`]\s*\*/.test(chain))
          offenders.push(`${where} select *`);
        // Reads only: select lists and filter/order columns. Writing the token
        // (the self sign-up insert) keeps its INSERT privilege.
        const readColumns = [
          ...chain.matchAll(
            /\.(select|eq|neq|is|in|not|or|filter|order|like|ilike|gt|gte|lt|lte)\(\s*["'`]([^"'`]*)/g,
          ),
        ].map((r) => r[2]);
        for (const column of HIDDEN) {
          if (readColumns.some((cols) => cols.includes(column)))
            offenders.push(`${where} ${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never embed athletes(*) or the claim credentials from another table through a non-admin client", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root("src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:([\w.]+)\s*)?\.from\(\s*["'`](\w+)["'`]\s*\)/g)) {
        if (/admin/i.test(m[1] ?? "")) continue;
        const rest = src.slice(m.index! + m[0].length);
        const chain = rest.slice(0, rest.search(/;|\n\s*\n/) + 1 || 600);
        const line = src.slice(0, m.index).split("\n").length;
        const where = `${file.slice(file.indexOf("/src/") + 1)}:${line}`;
        for (const sel of chain.matchAll(/\.select\(\s*["'`]([^"'`]*)/g)) {
          for (const embed of athleteEmbeds(sel[1])) {
            if (/(^|,)\s*\*\s*(,|$)/.test(embed.replace(/\([^()]*\)/g, "")))
              offenders.push(`${where} athletes(*)`);
            for (const column of HIDDEN) {
              if (embed.includes(column)) offenders.push(`${where} ${column}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds athletes embeds", () => {
    expect(athleteEmbeds("athlete_id, athletes!inner(id, parent_profiles(first_name))")).toEqual([
      "id, parent_profiles(first_name)",
    ]);
    expect(athleteEmbeds("id, athlete:athletes(*), coach_athletes(id)")).toEqual(["*"]);
    expect(athleteEmbeds("athletes:athlete_id(guardian_claim_code)")).toEqual([
      "guardian_claim_code",
    ]);
    expect(athleteEmbeds("id, athlete_goals(id), coach_athletes(athlete_id)")).toEqual([]);
  });
});

/** The column lists of every `athletes(...)` / `x:athletes(...)` / `athletes:athlete_id(...)` embed. */
function athleteEmbeds(select: string): string[] {
  const found: string[] = [];
  for (const m of select.matchAll(/[\w:!]*\bathletes?\b[\w:!]*\s*\(/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < select.length && depth > 0) {
      if (select[i] === "(") depth++;
      if (select[i] === ")") depth--;
      i++;
    }
    found.push(select.slice(start, i - 1));
  }
  return found;
}

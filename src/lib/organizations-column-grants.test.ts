import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261010120000_hide_organization_notes.sql. organizations.notes
 * is the Gradus admins' private note on a club (contract, seats, contacts), so
 * signed-in clients read organizations column by column and never see it, and
 * anon reads nothing. These checks keep later migrations and RLS-client code
 * from undoing that.
 */

const HIDDEN = ["notes"];
const HIDE_MIGRATION = "20261010120000_hide_organization_notes.sql";

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

const onOrganizations = /\bON (TABLE )?(public\.)?"?organizations"?(?![\w"])/i;
const toClientRole = /\bTO\b.*\b(anon|authenticated|public)\b/i;

/** Columns a statement grants SELECT on, or "table" for a table-wide grant. */
function selectGrant(stmt: string): string[] | "table" | null {
  if (!/^GRANT\b/i.test(stmt) || !toClientRole.test(stmt)) return null;
  if (/\bON ALL TABLES IN SCHEMA public\b/i.test(stmt)) {
    return /\b(ALL|SELECT)\b/i.test(stmt.split(/\bON\b/i)[0]) ? "table" : null;
  }
  if (!onOrganizations.test(stmt)) return null;
  const privileges = stmt.split(/\bON\b/i)[0];
  if (/\bALL\b/i.test(privileges) && !/\bALL\s*\(/i.test(privileges)) return "table";
  const columns = privileges.match(/\bSELECT\s*\(([^)]*)\)/i);
  if (columns) return columns[1].split(",").map((c) => c.trim().replace(/"/g, ""));
  return /\bSELECT\b/i.test(privileges) ? "table" : null;
}

/** Columns an ALTER TABLE ... organizations statement adds. */
function addedColumns(stmt: string): string[] {
  if (!/^ALTER TABLE (IF EXISTS )?(ONLY )?(public\.)?"?organizations"? /i.test(stmt)) return [];
  return [...stmt.matchAll(/\bADD (COLUMN )?(IF NOT EXISTS )?"?([a-z_][a-z0-9_]*)"?/gi)]
    .map((m) => m[3])
    .filter((name) => !/^(constraint|primary|unique|foreign|check)$/i.test(name));
}

describe("organizations column grants (admin notes)", () => {
  const hideIndex = migrations.indexOf(HIDE_MIGRATION);
  const later = migrations.slice(hideIndex + 1);

  it("revokes table-level SELECT and re-grants every column but notes to authenticated", () => {
    expect(hideIndex).toBeGreaterThanOrEqual(0);
    const sql = statements(read(HIDE_MIGRATION)).join(";\n");
    expect(sql).toMatch(/REVOKE SELECT ON public\.organizations FROM anon, authenticated/i);
    expect(sql).toMatch(/attname <> 'notes'/);
    expect(sql).toMatch(/GRANT SELECT \(%s\) ON public\.organizations TO authenticated'/);
  });

  it("no later migration grants table-wide SELECT on organizations, or notes, to a client role", () => {
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

  it("every column a later migration adds to organizations is granted SELECT in the same migration", () => {
    const missing: string[] = [];
    for (const file of later) {
      const stmts = statements(read(file));
      const granted = new Set(
        stmts.flatMap((s) => {
          const grant = selectGrant(s);
          return Array.isArray(grant) && /\bauthenticated\b/i.test(s) ? grant : [];
        }),
      );
      for (const column of stmts.flatMap(addedColumns)) {
        if (!HIDDEN.includes(column) && !granted.has(column)) missing.push(`${file}: ${column}`);
      }
    }
    // Fix: add `GRANT SELECT (<column>) ON public.organizations TO authenticated;`
    // to the migration that adds the column (or leave it out on purpose and add
    // it to HIDDEN here, if no client may read it).
    expect(missing).toEqual([]);
  });

  it("parses the shapes it guards", () => {
    expect(selectGrant("GRANT ALL ON public.organizations TO authenticated")).toBe("table");
    expect(selectGrant("GRANT SELECT ON TABLE organizations TO anon")).toBe("table");
    expect(
      selectGrant("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO authenticated"),
    ).toBe("table");
    expect(selectGrant("GRANT SELECT (id, name) ON public.organizations TO authenticated")).toEqual(
      ["id", "name"],
    );
    expect(selectGrant("GRANT ALL ON public.organizations TO service_role")).toBeNull();
    expect(selectGrant("GRANT SELECT ON public.organization_leads TO authenticated")).toBeNull();
    expect(
      addedColumns(
        "ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website text, ADD COLUMN phone text, ADD CONSTRAINT x CHECK (true)",
      ),
    ).toEqual(["website", "phone"]);
    expect(addedColumns("ALTER TABLE public.organization_leads ADD COLUMN note text")).toEqual([]);
  });
});

describe("RLS-client reads of organizations", () => {
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

  const hidden = new RegExp(`\\b(${HIDDEN.join("|")})\\b`);

  it("never select *, embed organizations(*), or read notes through a non-admin client", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root("src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:([\w.]+)\s*)?\.from\(\s*["'`](\w+)["'`]\s*\)/g)) {
        // Service-role clients (admin, supabaseAdmin, ctx.admin) may do all of it.
        if (/admin/i.test(m[1] ?? "")) continue;
        const rest = src.slice(m.index! + m[0].length);
        const chain = rest.slice(0, rest.search(/;|\n\s*\n/) + 1 || 600);
        const line = src.slice(0, m.index).split("\n").length;
        const where = `${file.slice(file.indexOf("/src/") + 1)}:${line}`;
        const selects = [...chain.matchAll(/\.select\(\s*["'`]([^"'`]*)/g)].map((s) => s[1]);

        // An embedded organizations(...) on any table, e.g. org_admins.
        for (const cols of selects) {
          for (const e of cols.matchAll(/\borganizations(?:!\w+)?\s*\(([^)]*)\)/g)) {
            if (/\*/.test(e[1])) offenders.push(`${where} embeds organizations(*)`);
            if (hidden.test(e[1])) offenders.push(`${where} embeds organizations.notes`);
          }
        }

        if (m[2] !== "organizations") continue;
        if (/\.select\(\s*\)|\.select\(\s*["'`]\s*\*/.test(chain))
          offenders.push(`${where} select *`);
        // Reads only: select lists and filter/order columns.
        const readColumns = [
          ...chain.matchAll(
            /\.(select|eq|neq|is|in|not|or|filter|order|like|ilike|gt|gte|lt|lte)\(\s*["'`]([^"'`]*)/g,
          ),
        ].map((r) => r[2]);
        if (readColumns.some((cols) => hidden.test(cols))) offenders.push(`${where} notes`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261010140000_athletes_insert_server_only.sql. Only the server
 * (service role) creates athlete rows: a signed-in client could otherwise
 * insert itself as an already-active, guardian-claimed minor. The behaviour
 * was checked on a Postgres 16 replay of every migration (see the PR); these
 * checks keep later migrations and app code from reopening client inserts.
 */

const FIX_MIGRATION = "20261010140000_athletes_insert_server_only.sql";

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const migrationsDir = root("supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (file: string) => readFileSync(`${migrationsDir}/${file}`, "utf8");

/**
 * SQL split into statements, comments dropped, whitespace collapsed. Quoted
 * strings, quoted identifiers and dollar-quoted bodies are kept whole.
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

const toClientRole = /\bTO\b.*\b(anon|authenticated|public)\b/i;

/** A GRANT that gives a client role INSERT on athletes (directly or schema-wide). */
function grantsClientInsert(stmt: string): boolean {
  if (!/^GRANT\b/i.test(stmt) || !toClientRole.test(stmt)) return false;
  const privileges = stmt.split(/\bON\b/i)[0];
  if (!/\b(ALL|INSERT)\b/i.test(privileges)) return false;
  return (
    /\bON ALL TABLES IN SCHEMA public\b/i.test(stmt) ||
    /\bON (TABLE )?("?public"?\.)?"?athletes"?( |$)/i.test(stmt)
  );
}

/** A policy on athletes that admits INSERT: FOR INSERT, FOR ALL, or no FOR clause (= ALL). */
function insertPolicy(stmt: string): boolean {
  if (!/^CREATE POLICY\b.*\bON ("?public"?\.)?"?athletes"?( |$)/i.test(stmt)) return false;
  const command = stmt.match(/\bFOR (ALL|SELECT|INSERT|UPDATE|DELETE)\b/i);
  return !command || /^(ALL|INSERT)$/i.test(command[1]);
}

describe("athletes inserts are server-only (migrations)", () => {
  const fixIndex = migrations.indexOf(FIX_MIGRATION);

  it("revokes INSERT from client roles and drops both client INSERT policies", () => {
    expect(fixIndex).toBeGreaterThanOrEqual(0);
    const sql = statements(read(FIX_MIGRATION));
    expect(sql).toContain("REVOKE INSERT ON public.athletes FROM anon, authenticated");
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Adults can insert own self-managed athlete row" ON public.athletes',
    );
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Parents can insert own athletes" ON public.athletes',
    );
  });

  it("no later migration gives a client role INSERT on athletes again", () => {
    const offenders: string[] = [];
    for (const file of migrations.slice(fixIndex + 1)) {
      for (const stmt of statements(read(file))) {
        if (grantsClientInsert(stmt) || insertPolicy(stmt)) {
          offenders.push(`${file}: ${stmt.slice(0, 120)}`);
        }
      }
    }
    // Create athlete rows on the server with the admin client instead.
    expect(offenders).toEqual([]);
  });

  it("parses the shapes it guards", () => {
    expect(grantsClientInsert("GRANT ALL ON public.athletes TO authenticated")).toBe(true);
    expect(grantsClientInsert("GRANT SELECT, INSERT ON TABLE athletes TO anon")).toBe(true);
    expect(
      grantsClientInsert("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated"),
    ).toBe(true);
    expect(grantsClientInsert("GRANT SELECT (id) ON public.athletes TO authenticated")).toBe(false);
    expect(grantsClientInsert("GRANT ALL ON public.athletes TO service_role")).toBe(false);
    expect(grantsClientInsert("GRANT INSERT ON public.athlete_goals TO authenticated")).toBe(false);
    expect(
      insertPolicy(
        'CREATE POLICY "x" ON public.athletes FOR INSERT TO authenticated WITH CHECK (true)',
      ),
    ).toBe(true);
    expect(insertPolicy('CREATE POLICY "x" ON public.athletes FOR ALL USING (true)')).toBe(true);
    expect(insertPolicy('CREATE POLICY "x" ON "public"."athletes" USING (true)')).toBe(true);
    expect(grantsClientInsert('GRANT INSERT ON "public"."athletes" TO authenticated')).toBe(true);
    expect(insertPolicy('CREATE POLICY "x" ON public.athletes FOR UPDATE USING (true)')).toBe(
      false,
    );
    expect(
      insertPolicy('CREATE POLICY "x" ON public.athlete_goals FOR INSERT WITH CHECK (true)'),
    ).toBe(false);
  });
});

describe("athletes inserts are server-only (app code)", () => {
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

  it("never inserts or upserts athletes through a non-admin client", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root("src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:([\w.]+)\s*)?\.from\(\s*["'`]athletes["'`]\s*\)/g)) {
        // Service-role clients (admin, supabaseAdmin, ctx.admin) may insert.
        if (/admin/i.test(m[1] ?? "")) continue;
        const rest = src.slice(m.index! + m[0].length);
        const chain = rest.slice(0, rest.search(/;|\n\s*\n/) + 1 || 600);
        if (/\.(insert|upsert)\(/.test(chain)) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${file.slice(file.indexOf("/src/") + 1)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

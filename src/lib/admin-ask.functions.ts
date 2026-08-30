import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

export interface AskDataResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

const MAX_ROWS = 500;

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|reindex|refresh|listen|notify|lock|comment|security|set)\b/i;
const FORBIDDEN_FN = /\b(pg_read_file|pg_read_binary_file|pg_sleep|pg_ls_dir|dblink|lo_import|lo_export)\b/i;

/** Normalizes and validates an ad-hoc query. Throws when it isn't a plain read. */
export function sanitizeReadOnlySql(raw: string): string {
  let sql = raw.trim();
  // Strip markdown fences the model sometimes emits.
  sql = sql.replace(/^```(?:sql)?\s*/i, "").replace(/```$/, "").trim();
  sql = sql.replace(/;\s*$/, "").trim();

  if (!sql) throw new Error("Empty query");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed");
  if (!/^(select|with)\s/i.test(sql)) throw new Error("Only SELECT queries are allowed");
  if (FORBIDDEN.test(sql)) throw new Error("Only read-only SELECT queries are allowed");
  if (FORBIDDEN_FN.test(sql)) throw new Error("That function isn't allowed here");
  if (sql.length > 8000) throw new Error("Query is too long");

  return sql;
}

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

async function execute(
  supabase: any,
  sql: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const wrapped = `select * from (${sql}) q limit ${MAX_ROWS + 1}`;
  const { data, error } = await supabase.rpc("admin_run_readonly_sql", { _sql: wrapped });
  if (error) throw new Error(error.message || "Query failed");
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const truncated = rows.length > MAX_ROWS;
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated };
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!cols.includes(key)) cols.push(key);
  }
  return cols;
}

/** Ask a plain-English question; the model writes the SQL and we run it. */
export const askData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().trim().min(3).max(1000) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<AskDataResult> => {
    await assertAdmin(context);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service is unavailable. Please try again later.");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { REPORTING_SCHEMA } = await import("./admin-ask-schema.server");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const { text } = await generateText({
      model,
      system:
        "You translate questions about a PostgreSQL (Supabase) database into a single read-only SQL query.\n" +
        "Rules:\n" +
        "- Return ONLY the SQL. No prose, no markdown fences, no trailing semicolon.\n" +
        "- Exactly one statement, starting with SELECT or WITH. Never write data.\n" +
        "- Prefer human-readable output: include names, not just ids.\n" +
        "- Round numeric aggregates to 1 decimal and alias every column readably.\n" +
        "- Always add an ORDER BY that makes the answer easy to read, and a LIMIT of 200 or less.\n\n" +
        "Schema:\n" +
        REPORTING_SCHEMA,
      prompt: data.question,
    });

    const sql = sanitizeReadOnlySql(text);
    const { rows, truncated } = await execute(context.supabase, sql);
    return { sql, columns: columnsOf(rows), rows, rowCount: rows.length, truncated };
  });

/** Run SQL the admin typed or edited by hand. */
export const runReadOnlySql = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sql: z.string().trim().min(6).max(8000) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<AskDataResult> => {
    await assertAdmin(context);
    const sql = sanitizeReadOnlySql(data.sql);
    const { rows, truncated } = await execute(context.supabase, sql);
    return { sql, columns: columnsOf(rows), rows, rowCount: rows.length, truncated };
  });

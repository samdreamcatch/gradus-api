import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards for 20261122120000_cron_history_cleanup.sql: scheduled-job history
 * (cron.job_run_details) is trimmed to a week, in small batches, on its
 * primary key. The behaviour was checked on a Postgres 16 copy of the table
 * with a million rows (see the PR). These checks read SQL as text.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const MIGRATION = "20261122120000_cron_history_cleanup.sql";
const sql = readFileSync(root(`supabase/migrations/${MIGRATION}`), "utf8");
/** The command the job runs: the text between the schedule's `$$` quotes. */
const command = sql.split("$$")[3] ?? "";

describe(MIGRATION, () => {
  it("schedules one cleanup job every five minutes, replacing any earlier copy", () => {
    expect(sql).toContain("cron.unschedule('cron-history-cleanup-every-5-min')");
    expect(sql).toMatch(
      /cron\.schedule\(\s*'cron-history-cleanup-every-5-min',\s*'\*\/5 \* \* \* \*'/,
    );
  });

  it("deletes only history more than seven days old, or runs that failed before starting", () => {
    expect(command).toContain("DELETE FROM cron.job_run_details");
    expect(command).toContain("coalesce(end_time, start_time) < now() - interval '7 days'");
    // A row still "starting" also has no times; only a failed one may go.
    expect(command).toContain("start_time IS NULL AND end_time IS NULL AND status = 'failed'");
  });

  it("looks only at the 5,000 oldest rows, matched on the primary key", () => {
    // The age filter sits outside the LIMIT, so a run never walks the whole
    // week of history that is kept.
    expect(command).toMatch(/ORDER BY runid\s+LIMIT 5000\b\s*\)\s*oldest\s+WHERE/);
    expect(command).toContain("runid = ANY (ARRAY(");
  });

  it("is the only migration that schedules this job", () => {
    const others = readdirSync(root("supabase/migrations")).filter(
      (f) =>
        f !== MIGRATION &&
        readFileSync(root(`supabase/migrations/${f}`), "utf8").includes(
          "cron-history-cleanup-every-5-min",
        ),
    );
    expect(others).toEqual([]);
  });
});

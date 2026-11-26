-- lovable-cron-fallback-reviewed: Time-based job-log retention uses bounded 5000-row batches every five minutes to drain the existing backlog without large deletes or scheduler-write triggers; 288 runs/day and recurring Cloud compute cost reviewed.
-- Keep only a week of scheduled-job history.
--
-- pg_cron writes a row to cron.job_run_details for every run of every job
-- (and updates it twice as the run starts and ends), and never removes any.
-- The table was 818 MB on 2026-11-22: about thirty times all of Gradus's own
-- data, on a database with about 224 MB of memory for caching
-- (shared_buffers). The same day a plain read of it took 57 seconds. It showed
-- no autovacuum and zero rows in the statistics, which fits pg_cron's source:
-- its scheduler process writes these rows without reporting them to the
-- statistics autovacuum reads.
--
-- Nothing in Gradus reads this table; it is only a log for debugging jobs.
-- This removes rows more than seven days old, which permanently deletes that
-- older history. Each run looks only at the 5,000 oldest rows (by run id, the
-- primary key) and deletes those that are old enough, so a run costs the same
-- small amount during the backlog and after it, and the backlog drains over a
-- few days without one large delete. Rows from runs that failed before they
-- started (no start or end time; pg_cron marks them failed after a restart)
-- go too once they reach the front.
--
-- Expect one heavy moment: the first batch's deletes are likely the first
-- writes here autovacuum can see, so it should vacuum the whole table soon after
-- (on a local 617 MB copy: about 30 s and 1 GB read). That is overdue
-- maintenance, not a regression; apply this at a quiet time.
--
-- Deleting frees space for reuse but does not shrink the file on disk; new
-- rows fill the freed space, so the file stops growing.
--
-- Pure SQL: no secret, webhook or network call.

DO $$ BEGIN PERFORM cron.unschedule('cron-history-cleanup-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'cron-history-cleanup-every-5-min',
  '*/5 * * * *',
  $$
  DELETE FROM cron.job_run_details
  WHERE runid = ANY (ARRAY(
    SELECT runid
    FROM (
      SELECT runid, start_time, end_time, status
      FROM cron.job_run_details
      ORDER BY runid
      LIMIT 5000
    ) oldest
    WHERE coalesce(end_time, start_time) < now() - interval '7 days'
       OR (start_time IS NULL AND end_time IS NULL AND status = 'failed')
  ));
  $$
);

-- Check after applying (expect one row, active):
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'cron-history-cleanup-every-5-min';
-- And, after a few days, that the oldest timed row is under a week old (this
-- walks the primary key, so it stays quick; do NOT run an unbounded SELECT on
-- the table):
--   SELECT start_time FROM cron.job_run_details
--    WHERE start_time IS NOT NULL ORDER BY runid LIMIT 1;

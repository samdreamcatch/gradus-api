/**
 * Competition recap prompts (PRD §6.6 "Competition recap prompt (day after a
 * followed competition)").
 *
 * `getPendingCompetitionRecap` decides on read whether to show the recap
 * card; nothing server-side fires the morning after a competition ends. This
 * daily pass does: it finds every `competition_attendance` row for a
 * competition that ended yesterday (America/New_York) that is neither
 * dismissed nor recapped, records the pair in
 * `competition_recap_prompts_sent`, and pushes the viewer with the
 * `recaps/<competitionId>` route the app already handles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { ASK_WINDOW_DAYS } from "./competition-recap.server";
import { addDays, parseIsoDate, toIsoDate } from "./lesson-recurrence";
import { nowInRinkTz } from "./lesson-reminders.server";
import { notifyUsers, type PushDeps } from "./push-notify.server";

type Client = SupabaseClient<Database>;

export type RecapPromptContext = { admin: Client; push?: PushDeps };
export type RecapPromptResult = { competitions: number; prompted: number; sent: number };

type AttendanceRow = { user_id: string; competition_id: string };

export async function computeCompetitionRecapPrompts(
  ctx: RecapPromptContext,
  now: Date = new Date(),
): Promise<RecapPromptResult> {
  const { admin } = ctx;
  const { dateIso } = nowInRinkTz(now);
  const yesterday = toIsoDate(addDays(parseIsoDate(dateIso), -1));

  // The read-time card keeps asking for ASK_WINDOW_DAYS after the end date, so a
  // missed tick (deploy, 5xx) or a late-filled ends_on is caught on a later day;
  // the (user, competition) dedupe absorbs the repeats.
  const windowStart = toIsoDate(addDays(parseIsoDate(dateIso), -ASK_WINDOW_DAYS));
  const compsRes = await admin
    .from("competitions")
    .select("id, name")
    .gte("ends_on", windowStart)
    .lte("ends_on", yesterday);
  if (compsRes.error) dbError(compsRes.error);
  const comps = (compsRes.data ?? []) as { id: string; name: string | null }[];
  if (comps.length === 0) return { competitions: 0, prompted: 0, sent: 0 };
  const nameById = new Map(comps.map((c) => [c.id, c.name || "the competition"]));

  const attendanceRes = await admin
    .from("competition_attendance")
    .select("user_id, competition_id")
    .in(
      "competition_id",
      comps.map((c) => c.id),
    )
    .is("dismissed_at", null)
    .is("recap_done_at", null)
    // Coaches record attendance too, but their prompt is the Roster post-event
    // card; the recaps/<id> screen is parent/athlete-only and their app has no
    // Plans tab to open it on.
    .neq("viewer_role", "coach");
  if (attendanceRes.error) dbError(attendanceRes.error);
  const pairs = new Map<string, AttendanceRow>();
  for (const r of (attendanceRes.data ?? []) as AttendanceRow[]) {
    pairs.set(`${r.user_id}|${r.competition_id}`, r);
  }
  if (pairs.size === 0) return { competitions: comps.length, prompted: 0, sent: 0 };

  // Not in the generated Database types until Lovable regenerates them after
  // the migration is applied; the board tables use the same untyped handle.
  const bookkeeping = admin as unknown as { from: (table: string) => any };
  const upsertRes = await bookkeeping
    .from("competition_recap_prompts_sent")
    .upsert(
      Array.from(pairs.values()).map((r) => ({
        user_id: r.user_id,
        competition_id: r.competition_id,
        sent_at: now.toISOString(),
      })),
      { onConflict: "user_id,competition_id", ignoreDuplicates: true },
    )
    .select("user_id, competition_id");
  if (upsertRes.error && (upsertRes.error as { code?: string }).code !== "23505") {
    dbError(upsertRes.error);
  }
  const fresh = (upsertRes.data ?? []) as AttendanceRow[];

  let sent = 0;
  for (const r of fresh) {
    const report = await notifyUsers(
      admin,
      [r.user_id],
      {
        type: "competition_recap",
        route: `recaps/${r.competition_id}`,
        title: "How did it go?",
        body: `Share a quick recap of ${nameById.get(r.competition_id) ?? "the competition"} with your coach.`,
        collapseId: `recap:${r.competition_id}:${r.user_id}`,
      },
      ctx.push,
    );
    sent += report.sent;
    // Nothing got through and a failure was transient: release the dedupe row so
    // tomorrow's tick (still inside the ask window) retries.
    if (report.sent === 0 && report.failed - report.pruned > 0) {
      await bookkeeping
        .from("competition_recap_prompts_sent")
        .delete()
        .eq("user_id", r.user_id)
        .eq("competition_id", r.competition_id);
    }
  }

  return { competitions: comps.length, prompted: fresh.length, sent };
}

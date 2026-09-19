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

  const compsRes = await admin.from("competitions").select("id, name").eq("ends_on", yesterday);
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
    .is("recap_done_at", null);
  if (attendanceRes.error) dbError(attendanceRes.error);
  const pairs = new Map<string, AttendanceRow>();
  for (const r of (attendanceRes.data ?? []) as AttendanceRow[]) {
    if (!r.user_id) continue;
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
  }

  return { competitions: comps.length, prompted: fresh.length, sent };
}

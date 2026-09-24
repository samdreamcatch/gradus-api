/**
 * The internal admin **Usage** page's data (PRD §6.12 "Reporting", milestone
 * A1). Internal admins only (`has_role(admin)`), like the rest of /admin.
 * Reads go through the service-role report functions in migration
 * 20260923010000; every privacy rule (the "<5" floor for adults, the
 * 10-minor floor for clubs and regions, withheld remainders, no per-coach
 * view of minors) is applied in `src/lib/analytics-report.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  adultUsers,
  minorGroupRows,
  type GroupActivity,
  type MinorGroupRow,
  type RosterOrg,
} from "./analytics-report";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

export interface AreaRow {
  weekStart: string;
  role: string;
  area: string;
  minutes: number;
  users: string;
}

export interface ResourceRow {
  resourceId: string;
  title: string;
  sport: string;
  origin: "library" | "coach" | "unknown";
  opens: number;
  users: string;
  minorOpens: number;
  readMinutes: number;
  medianReadSeconds: number | null;
  medianDepth: number | null;
  shares: number;
  offlineSaves: number;
}

export interface AskRow {
  weekStart: string;
  questions: number;
  grounded: number;
  safety: number;
  saved: number;
  sourceTaps: number;
}

export interface UsageReport {
  since: string;
  areas: AreaRow[];
  resources: ResourceRow[];
  ask: AskRow[];
  minors: {
    clubs: MinorGroupRow[];
    regions: MinorGroupRow[];
    medianSafeSportPerMinor: number | null;
  };
}

const rpc = async <T>(admin: AnyClient, fn: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) dbError(error);
  return (data ?? []) as T;
};

export const adminUsageReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ weeks: z.union([z.literal(4), z.literal(12), z.literal(52)]).default(4) })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<UsageReport> => {
    await assertAdmin(context as { userId: string; supabase: AnyClient });
    const admin = await adminClient();
    const since = new Date(Date.now() - data.weeks * 7 * 86_400_000).toISOString();

    const [areaRows, resourceRows, askRows, groupRows, rosterRows, noClub] = await Promise.all([
      rpc<
        { week_start: string; role: string; area: string; total_ms: number; adult_users: number }[]
      >(admin, "analytics_area_report", { p_since: since }),
      rpc<
        {
          resource_id: string;
          opens: number;
          adult_users: number;
          minor_opens: number;
          read_ms_total: number;
          read_ms_median: number | null;
          depth_median: number | null;
          shares: number;
          offline_saves: number;
        }[]
      >(admin, "analytics_resource_report", { p_since: since }),
      rpc<
        {
          week_start: string;
          questions: number;
          grounded: number;
          safety: number;
          saved: number;
          source_taps: number;
        }[]
      >(admin, "analytics_ask_report", { p_since: since }),
      rpc<
        {
          kind: GroupActivity["kind"];
          key: string;
          events: number;
          safe_sport_opens: number;
          resource_opens: number;
          screen_ms: number;
        }[]
      >(admin, "analytics_minor_group_report", { p_since: since }),
      rpc<{ org_id: string; org_name: string; region: string | null; minors: number }[]>(
        admin,
        "analytics_minor_roster",
      ),
      rpc<number>(admin, "analytics_minor_no_club_count"),
    ]);

    const ids = resourceRows.map((r) => r.resource_id);
    const meta = new Map<string, { title: string; sport: string; coach_id: string | null }>();
    if (ids.length) {
      const { data: rs, error } = await admin
        .from("resources")
        .select("id, title, sport, coach_id")
        .in("id", ids);
      if (error) dbError(error);
      for (const r of rs ?? []) meta.set(r.id, r);
    }

    const roster: RosterOrg[] = rosterRows.map((r) => ({
      orgId: r.org_id,
      name: r.org_name,
      region: r.region,
      minors: Number(r.minors),
    }));
    const activity: GroupActivity[] = groupRows.map((g) => ({
      kind: g.kind,
      key: g.key,
      events: Number(g.events),
      safeSportOpens: Number(g.safe_sport_opens),
      resourceOpens: Number(g.resource_opens),
      screenMs: Number(g.screen_ms),
    }));
    const minors = minorGroupRows(roster, activity, Number(noClub ?? 0));

    return {
      since,
      areas: areaRows
        .map((r) => ({
          weekStart: r.week_start,
          role: r.role,
          area: r.area,
          minutes: Math.round(Number(r.total_ms) / 60000),
          users: adultUsers(Number(r.adult_users)),
        }))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.minutes - a.minutes),
      resources: resourceRows
        .map((r) => {
          const m = meta.get(r.resource_id);
          return {
            resourceId: r.resource_id,
            title: m?.title ?? "(deleted resource)",
            sport: m?.sport ?? "",
            origin: (m ? (m.coach_id ? "coach" : "library") : "unknown") as ResourceRow["origin"],
            opens: Number(r.opens),
            users: adultUsers(Number(r.adult_users)),
            minorOpens: Number(r.minor_opens),
            readMinutes: Math.round(Number(r.read_ms_total) / 60000),
            medianReadSeconds:
              r.read_ms_median === null ? null : Math.round(Number(r.read_ms_median) / 1000),
            medianDepth:
              r.depth_median === null ? null : Math.round(Number(r.depth_median) * 100) / 100,
            shares: Number(r.shares),
            offlineSaves: Number(r.offline_saves),
          };
        })
        .sort((a, b) => b.opens - a.opens),
      ask: askRows
        .map((r) => ({
          weekStart: r.week_start,
          questions: Number(r.questions),
          grounded: Number(r.grounded),
          safety: Number(r.safety),
          saved: Number(r.saved),
          sourceTaps: Number(r.source_taps),
        }))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
      minors: {
        clubs: minors.clubs,
        regions: minors.regions,
        medianSafeSportPerMinor: minors.baseline.medianSafeSportPerMinor,
      },
    };
  });

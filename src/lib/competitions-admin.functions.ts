import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Throws if the caller is not an admin. */
async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

async function adminDb() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as unknown as { from: (t: string) => any };
}

export interface AdminCompetition {
  id: string;
  slug: string;
  name: string;
  datesLabel: string;
  location: string;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  sourceUrl: string;
  generatedAt: string | null;
  error: string | null;
  fetchCount: number;
  rinks: string[];
}

/** `36666` or a full leaderboard URL -> base URL, comp id, year. */
function parseSource(input: string): { base: string; compId: string; year: number } {
  const trimmed = input.trim();
  let base: string;
  if (/^https?:/i.test(trimmed)) {
    base = trimmed.replace(/\/index\.asp.*$/i, "").replace(/\/+$/, "");
  } else {
    const year = new Date().getFullYear();
    base = `https://ijs.usfigureskating.org/leaderboard/results/${year}/${trimmed}`;
  }
  const m = /\/results\/(\d{4})\/([^/]+)/.exec(base);
  return {
    base,
    compId: m?.[2] ?? trimmed,
    year: m ? Number(m[1]) : new Date().getFullYear(),
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** `08/18/2026 - 08/23/2026 (EDT)` -> ISO start/end dates. */
function parseDateRange(label: string): { startsOn: string | null; endsOn: string | null } {
  const dates = [...label.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(
    (m) => `${m[3]}-${m[1]}-${m[2]}`,
  );
  return { startsOn: dates[0] ?? null, endsOn: dates[dates.length - 1] ?? dates[0] ?? null };
}

export const listCompetitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCompetition[]> => {
    await assertAdmin(context);
    const db = await adminDb();
    const comps = await db
      .from("competitions")
      .select("*")
      .order("starts_on", { ascending: false, nullsFirst: false });
    const rows = (comps.data ?? []) as any[];
    if (rows.length === 0) return [];
    const snaps = await db
      .from("competition_snapshots")
      .select("competition_id, generated_at, error, fetch_count, payload")
      .in(
        "competition_id",
        rows.map((r) => r.id),
      );
    const byId = new Map<string, any>(((snaps.data ?? []) as any[]).map((s) => [s.competition_id, s]));

    return rows.map((r) => {
      const s = byId.get(r.id);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        datesLabel: r.dates_label,
        location: r.location,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        active: r.active,
        sourceUrl: `${r.ijs_base_url}/index.asp`,
        generatedAt: s?.generated_at ?? null,
        error: s?.error ?? null,
        fetchCount: s?.fetch_count ?? 0,
        rinks: (s?.payload?.rinks ?? []).map((k: any) => k.name as string),
      };
    });
  });

/**
 * Add or update a competition from an IJS id or URL. Fetches the index once to
 * confirm the name, dates and location before saving.
 */
export const upsertCompetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        source: z.string().trim().min(1),
        slug: z.string().trim().max(60).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; slug: string }> => {
    await assertAdmin(context);
    const db = await adminDb();
    const { fetchPage, parseIndex } = await import("./ijs-scrape.server");
    const { refreshCompetition } = await import("./board-refresh.server");

    const { base, compId, year } = parseSource(data.source);
    const { competition } = parseIndex(await fetchPage(`${base}/index.asp`), year);
    const { startsOn, endsOn } = parseDateRange(competition.dates);
    const slug = slugify(data.slug || competition.name || compId) || compId;

    const row = {
      slug,
      ijs_base_url: base,
      comp_id: compId,
      year,
      name: competition.name,
      dates_label: competition.dates,
      location: competition.location,
      starts_on: startsOn,
      ends_on: endsOn,
      updated_at: new Date().toISOString(),
    };

    const saved = data.id
      ? await db.from("competitions").update(row).eq("id", data.id).select("id, slug").single()
      : await db.from("competitions").upsert(row, { onConflict: "slug" }).select("id, slug").single();
    if (saved.error) throw new Error(saved.error.message);

    await refreshCompetition({ id: saved.data.id, ijs_base_url: base, year }, { force: true });
    return { id: saved.data.id as string, slug: saved.data.slug as string };
  });

export const refreshCompetitionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertAdmin(context);
    const db = await adminDb();
    const { refreshCompetition } = await import("./board-refresh.server");
    const comp = await db
      .from("competitions")
      .select("id, ijs_base_url, year")
      .eq("id", data.id)
      .single();
    if (!comp.data) throw new Error("Not found");
    const payload = await refreshCompetition(comp.data, { force: true });
    return { ok: payload !== null };
  });

export const setCompetitionActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const db = await adminDb();
    await db
      .from("competitions")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

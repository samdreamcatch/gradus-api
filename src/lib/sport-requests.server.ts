/**
 * "Request a sport" (beta feedback 2026-10-07, Mariah's call): the
 * replacement for custom sports. A coach who can't find their sport names
 * it; Gradus stores the request (Admin → Leads) and emails the team, and the
 * coach picks a listed sport in the meantime. Shared by the web's server
 * function (sport-requests.functions.ts) and `POST /api/v1/sport-requests`.
 */
import { z } from "zod";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { GRADUS_SUPPORT_EMAIL } from "./safe-sport-content";

export type SportRequestsDb = { from: (table: string) => any };

export const SPORT_REQUEST_SOURCES = [
  "coach_signup",
  "coach_onboarding",
  "coach_settings",
] as const;
export type SportRequestSource = (typeof SPORT_REQUEST_SOURCES)[number];

export const sportRequestInput = z.object({
  sport: z.string().trim().min(1, "Name the sport").max(80),
  source: z.enum(SPORT_REQUEST_SOURCES),
});
export type SportRequestInput = z.infer<typeof sportRequestInput>;

export type SportRequestEmail = { to: string; subject: string; text: string; html: string };

export type SportRequestContext = {
  userId: string;
  email: string | null;
  admin: SportRequestsDb;
  /** The caller's role, as the feedback form detects it. */
  role: () => Promise<string>;
  /** Queues the team's email; a failure is logged, never thrown. */
  notify: (email: SportRequestEmail) => Promise<unknown>;
};

const SOURCE_LABELS: Record<SportRequestSource, string> = {
  coach_signup: "coach sign-up",
  coach_onboarding: "coach onboarding",
  coach_settings: "Settings → Sports and levels",
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * One line of plain text: control characters (CR/LF included) and runs of
 * whitespace collapse to a single space. The name lands in an email subject,
 * the admin list and the database, so a pasted newline must not survive.
 */
export function normalizeSportName(raw: string): string {
  return raw.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

/** Roles that may file a request. Athletes and parents never see the picker. */
const REQUESTER_ROLES = new Set(["coach", "admin", "unknown"]);

/** The team's notice: who asked, for what, from where. */
export function sportRequestEmail(args: {
  sport: string;
  role: string;
  email: string | null;
  source: SportRequestSource;
}): SportRequestEmail {
  const role = args.role === "unknown" ? "user" : args.role;
  const article = role === "admin" || role === "athlete" ? "An" : "A";
  const who = `${article} ${role}${args.email ? ` (${args.email})` : ""}`;
  const where = SOURCE_LABELS[args.source];
  const link = "https://gradus.training/admin/leads";
  return {
    to: GRADUS_SUPPORT_EMAIL,
    subject: `Sport request: ${args.sport}`,
    text: `${who} asked Gradus to add "${args.sport}" from ${where}.\n\nAll requests: ${link}`,
    html: `<p>${escapeHtml(who)} asked Gradus to add <strong>${escapeHtml(args.sport)}</strong> from ${escapeHtml(where)}.</p><p><a href="${link}">All requests</a></p>`,
  };
}

/** `requestSport`: store one request and email the team. */
export async function requestSport(
  ctx: SportRequestContext,
  input: SportRequestInput,
): Promise<{ ok: true }> {
  const sport = normalizeSportName(input.sport);
  if (!sport) {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Name the sport" });
  }
  const role = await ctx.role();
  if (!REQUESTER_ROLES.has(role)) {
    throw new ApiError({
      code: "wrong_role",
      status: 403,
      message: "Only coaches can request a sport.",
    });
  }
  const { error } = await ctx.admin.from("sport_requests").insert({
    user_id: ctx.userId,
    role,
    requested_sport: sport,
    source: input.source,
  });
  if (error) dbError(error);
  try {
    await ctx.notify(sportRequestEmail({ sport, role, email: ctx.email, source: input.source }));
  } catch (e) {
    console.error("[sport-requests] notify failed", e);
  }
  return { ok: true };
}

export interface SportRequestRow {
  id: string;
  sport: string;
  role: string;
  source: SportRequestSource;
  createdAt: string;
  resolvedAt: string | null;
}

/** Admin → Leads: newest first. */
export async function listSportRequests(admin: SportRequestsDb): Promise<SportRequestRow[]> {
  const { data, error } = await admin
    .from("sport_requests")
    .select("id, requested_sport, role, source, created_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(500);
  // Until Lovable applies 20261008120000 the table is missing: nothing to list yet.
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return [];
  if (error) dbError(error);
  return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
    id: r.id,
    sport: r.requested_sport,
    role: r.role,
    source: r.source,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null,
  }));
}

/** Admin: mark a request handled (or reopen it). */
export async function setSportRequestResolved(
  admin: SportRequestsDb,
  id: string,
  resolved: boolean,
): Promise<{ ok: true }> {
  const { error } = await admin
    .from("sport_requests")
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) dbError(error);
  return { ok: true };
}

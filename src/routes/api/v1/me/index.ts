import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute, type DefineApiRouteOptions } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { deleteMyAccountRoute } from "@/lib/api/account-routes";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import {
  athleteAccountStateSchema,
  parentVerificationSchema,
} from "@/lib/api/guardian-verification-schema";
import {
  PARENT_VERIFICATION_COLUMNS,
  toParentVerificationDTO,
  type AthleteAccountState,
  type ParentVerificationRow,
} from "@/lib/guardian-verification.server";
import { callerSports } from "@/lib/caller-sports.server";
import { isMinorOrUnconfirmed } from "@/lib/athlete-age";
import { getAiConsent } from "@/lib/ai-consent.server";
import { getInvoiceCurrency } from "@/lib/invoice-currency.server";

const outputSchema = z.object({
  userId: z.string(),
  /** Same precedence as the web's `getMyRole`; `null` until a profile exists. */
  role: z.enum(["coach", "parent", "athlete", "org_admin"]).nullable(),
  /** Coach only: whether onboarding has finished. `null` for other roles. */
  onboardingComplete: z.boolean().nullable(),
  terms: z.object({
    accepted: z.boolean(),
    version: z.string(),
    acceptedAt: z.string().nullable(),
  }),
  /** Parent only (PRD §6.13 A1): adult-verification state; `null` for other roles. */
  parentVerification: parentVerificationSchema.nullable(),
  /** Athlete only (PRD §6.13 A4): `active`, `provisional` or `paused`; `null` for other roles. */
  athleteAccountState: athleteAccountStateSchema.nullable(),
  /**
   * Athlete only (decision #48): whether this athlete may make plans by voice.
   * False under 18 or with no birthdate on file (the server refuses their audio
   * with 403 `text_only`); `null` for other roles. Always sent; optional in the
   * contract, and an app treats a missing value as false, so a build that reads
   * it never offers voice to a minor against an older server.
   */
  athleteVoiceToPlan: z.boolean().nullable().optional(),
  /**
   * Sport keys this account touches (a coach's levels; a parent's or
   * athlete's goal and coached sports), sorted. The iOS shell shows the Live
   * board only when this includes `figure_skating` (2026-09-26). Empty for
   * org admins and callers without a profile. Always sent; optional in the
   * contract so an app build that reads it still decodes an older server.
   */
  sports: z.array(z.string()).optional(),
  /**
   * The caller's answer to the AI permission screen (App Review 5.1.2(i);
   * `GET`/`PUT /me/ai-consent`). The app shows the screen while it is
   * `unasked`, to everyone but athletes under 18. Always sent; optional in
   * the contract so an app build that reads it still decodes an older server.
   */
  aiConsent: z
    .object({
      state: z.enum(["granted", "declined", "unasked"]),
      version: z.string(),
      decidedAt: z.string().nullable(),
    })
    .optional(),
  /**
   * Coach only (decision #69): the currency the coach invoices in, an ISO
   * 4217 code (`PUT /me/invoice-currency` sets it). Display only: nothing is
   * converted. Absent for other roles, and for a coach whenever the server
   * could not read it (the column's migration is not applied, or this one read
   * failed): absent means unknown, so the app keeps what it last knew, and
   * reads US dollars and hides the setting only while it has never been given
   * one. A string, not an enum, so a currency added later still decodes in a
   * build that predates it.
   */
  invoiceCurrency: z.string().optional(),
});

type MeOutput = z.infer<typeof outputSchema>;

/** What a coach's or an athlete's `/me` reads once the role is known. */
type RoleReads = { sports?: string[]; invoiceCurrency?: string };
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * The role the coach, parent and athlete rows decide, in `getMyRole`'s order:
 * an onboarded coach, then a parent, then an athlete, then a coach who has
 * not finished onboarding. `null` means none of them: only then does an org
 * admin row count.
 */
function profileRole(
  coach: { onboarded_at: string | null } | null,
  parent: object | null,
  athlete: object | null,
): { role: "coach" | "parent" | "athlete" | null; onboardingComplete: boolean | null } {
  if (coach?.onboarded_at) return { role: "coach", onboardingComplete: true };
  if (parent) return { role: "parent", onboardingComplete: null };
  if (athlete) return { role: "athlete", onboardingComplete: null };
  if (coach) return { role: "coach", onboardingComplete: false };
  return { role: null, onboardingComplete: null };
}

/**
 * Minimal `GET /me` (PRD Appendix A): role, onboarding state, and terms
 * status, which is what the iOS app shell needs to pick the tab bar and the
 * blocking terms sheet (milestone I1). It grows into the full composite
 * (profile summary, entitlement, guardian status, flags, unread count, ETag)
 * in B3 by adding fields, never changing these. S1 (2026-09-24) added the
 * parent's adult-verification state and the athlete's account state
 * (PRD §6.13 A1, A4).
 *
 * Role resolution reproduces `getMyRole` in
 * `src/lib/parent-signup.functions.ts` through `ctx.admin` (same tables,
 * same precedence) rather than importing it, so the web function is untouched.
 *
 * `DELETE /me` (PRD §6.4 "Delete account") lives in
 * `src/lib/api/account-routes.ts`: the client must send the JSON body
 * (`confirmPhrase`, `minorChoices`) with the DELETE request — `defineApiRoute`
 * parses a body for any method once `input` is set.
 *
 * The options are a function (as `passwordRouteOptions` is) so
 * src/lib/api/me-routes.test.ts can run the handler through
 * `createApiRouteHandler` with a fake admin.
 */
export function getMeRouteOptions(): DefineApiRouteOptions<undefined, MeOutput> {
  return {
    method: "GET",
    path: "/api/v1/me",
    operationId: "getMe",
    auth: "user",
    summary: "Session summary for the caller: role, onboarding state, terms status",
    output: outputSchema,
    handler: async ({ ctx }) => {
      const { admin, userId } = requireContext(ctx);
      // The three reads that decide a coach, parent or athlete role. The coach
      // and athlete rows carry the sports PostgREST can embed, so those cost
      // no request of their own. `athlete_goals` is not among them: its
      // `athlete_id` has no foreign key, and embedding it answers PGRST200.
      const profiles = Promise.all([
        admin
          .from("coach_profiles")
          .select("id, onboarded_at, coach_levels(sport)")
          .eq("user_id", userId)
          .maybeSingle(),
        admin
          .from("parent_profiles")
          .select(PARENT_VERIFICATION_COLUMNS)
          .eq("user_id", userId)
          .maybeSingle(),
        // No .limit(1): the row's account_state is read, so a duplicate
        // user_id must surface (PGRST116) instead of an arbitrary row.
        admin
          .from("athletes")
          .select("id, account_state, birthdate, coach_athlete_sports(sport)")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      // What a coach or an athlete still needs a request for (the coach's
      // invoice currency, the athlete's goal sports). It starts when those
      // three reads have answered, not after all six, so it overlaps the
      // slower of the other three instead of following them. Those three
      // have closed by then: with this one there are at most four open, and
      // never more than six (a Worker holds six and queues the rest). Its
      // failure is kept, not thrown, so a failed read below answers first and
      // nothing is left unhandled when that answer does not wait for it.
      const roleReads: Promise<Settled<RoleReads>> = profiles
        .then(async ([coach, parent, athlete]): Promise<RoleReads> => {
          // The 500 below answers; nothing more is read.
          if (coach.error || parent.error || athlete.error) return {};
          const { role } = profileRole(coach.data, parent.data, athlete.data);
          if (role === "coach" && coach.data) {
            const [sports, invoiceCurrency] = await Promise.all([
              // No request: the levels came with the coach row.
              callerSports(admin, {
                role: "coach",
                coachId: coach.data.id,
                levels: coach.data.coach_levels,
              }),
              // Coach only, so no request for anyone else. Its own query, and
              // `undefined` whenever it can't be read (the column may not
              // exist yet): it never fails `/me`. By role, so an account
              // whose role resolved to something else (a parent with a
              // leftover coach row) gets none.
              getInvoiceCurrency(admin, userId),
            ]);
            return { sports, invoiceCurrency };
          }
          if (role === "athlete" && athlete.data) {
            return {
              // One request (the goals); the coached sports came with the athlete row.
              sports: await callerSports(admin, {
                role: "athlete",
                athleteId: athlete.data.id,
                coachSports: athlete.data.coach_athlete_sports,
              }),
            };
          }
          return {};
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );

      // Six requests in the first wave, and no more: a Worker holds six open
      // at once and queues the rest, so a seventh here would wait behind one
      // of these.
      const [[coach, parent, athlete], orgAdmin, terms, aiConsent] = await Promise.all([
        profiles,
        admin.from("org_admins").select("id").eq("user_id", userId).limit(1).maybeSingle(),
        admin
          .from("terms_acceptances")
          .select("terms_version, accepted_at")
          .eq("user_id", userId)
          .eq("terms_version", CURRENT_TERMS_VERSION)
          .maybeSingle(),
        // Never fails `/me`: the AI routes check permission on their own.
        getAiConsent(admin, userId).catch((err) => {
          console.error("[api] me ai-consent", err);
          return undefined;
        }),
      ]);
      const failed = [coach, parent, athlete, orgAdmin, terms].find((r) => r.error);
      if (failed?.error) {
        console.error("[api] me", failed.error);
        throw new ApiError({
          code: "internal",
          status: 500,
          message: "Something went wrong. Please try again.",
        });
      }

      const fromProfiles = profileRole(coach.data, parent.data, athlete.data);
      const role: MeOutput["role"] = fromProfiles.role ?? (orgAdmin.data ? "org_admin" : null);
      const { onboardingComplete } = fromProfiles;

      // Awaited only now, after the checks above: a failed first-wave read
      // answers without waiting for it, and its own failure answers only
      // after them, as when it ran after them.
      const roleRead = await roleReads;
      if (!roleRead.ok) throw roleRead.error;
      const { invoiceCurrency } = roleRead.value;
      // A parent's sports are read here, as before: every athlete they guard.
      const sports =
        role === "parent" && parent.data
          ? await callerSports(admin, {
              role: "parent",
              parentId: (parent.data as { id: string }).id,
            })
          : (roleRead.value.sports ?? []);

      const parentRow = parent.data as ParentVerificationRow | null;
      const athleteRow = athlete.data as {
        account_state?: string | null;
        birthdate?: string | null;
      } | null;

      return {
        userId,
        role,
        onboardingComplete,
        terms: {
          accepted: !!terms.data,
          version: CURRENT_TERMS_VERSION,
          acceptedAt: terms.data?.accepted_at ?? null,
        },
        parentVerification: parentRow ? toParentVerificationDTO(parentRow) : null,
        athleteAccountState: athleteRow
          ? ((athleteRow.account_state as AthleteAccountState | null | undefined) ?? "active")
          : null,
        athleteVoiceToPlan:
          role === "athlete" && athleteRow ? !isMinorOrUnconfirmed(athleteRow.birthdate) : null,
        sports,
        aiConsent,
        invoiceCurrency,
      };
    },
  };
}

export const Route = createFileRoute("/api/v1/me/")({
  server: {
    handlers: {
      ...defineApiRoute(getMeRouteOptions()),
      ...defineApiRoute(deleteMyAccountRoute()),
    },
  },
});

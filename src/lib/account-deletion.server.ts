/**
 * Server-only account deletion. Removes the caller's identity and personal
 * data while keeping shared history (threads, plans, invoices) coherent for
 * the other participants. See the account-deletion plan for the full rules.
 *
 * Shared by the web server functions (account-deletion.functions.ts) and the
 * `GET /api/v1/me/deletion-impact` and `DELETE /api/v1/me` routes (PRD §6.4
 * "Delete account", §7.12). The confirmation phrase, its input schema, and
 * the phrase check live here so both callers agree on them.
 */
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DeletionRole = "coach" | "parent" | "athlete" | "unknown";

export type DeletionResult = {
  role: DeletionRole;
  athletesDeleted: number;
  athletesTransferred: number;
};

/** What the caller must type to confirm deletion (web and API alike). */
export const DELETE_CONFIRM_PHRASE = "DELETE ACCOUNT";

export const deleteAccountInput = z.object({
  confirmPhrase: z.string().min(1),
  minorChoices: z
    .array(
      z.object({
        athleteId: z.string().uuid(),
        action: z.enum(["keep", "delete"]),
      }),
    )
    .default([]),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountInput>;

/** True when the typed phrase matches `DELETE_CONFIRM_PHRASE`, ignoring surrounding whitespace and case. */
export function isDeleteConfirmed(phrase: string): boolean {
  return phrase.trim().toUpperCase() === DELETE_CONFIRM_PHRASE;
}

/** A minor who would be left without an adult on file — see `listOrphanedMinors`. */
export type OrphanedMinor = { id: string; firstName: string; guardianEmail: string | null };

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cancelSubscription(
  subscriptionId: string | null,
  environment: string | null,
): Promise<void> {
  if (!subscriptionId) return;
  try {
    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient((environment as "sandbox" | "live") ?? "sandbox");
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err) {
    console.error("[account-deletion] subscription cancel failed", err);
  }
}

/** Remove every voice note this user sent from the private bucket. */
async function deleteVoiceNotes(userId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("audio_url")
    .eq("sender_user_id", userId)
    .not("audio_url", "is", null);
  const paths = (data ?? []).map((r) => r.audio_url).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from("voice-notes").remove(paths);
  if (error) console.error("[account-deletion] voice note cleanup failed", error);
}

async function deleteCoachResources(coachId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("resources")
    .select("id, storage_path")
    .eq("coach_id", coachId);
  const rows = data ?? [];
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabaseAdmin.storage.from("resource-pdfs").remove(paths);
    if (error) console.error("[account-deletion] resource cleanup failed", error);
  }
  if (rows.length > 0) {
    await supabaseAdmin
      .from("resources")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      );
  }
}

/** De-identify an athlete record in place so coach history and invoices survive. */
async function deIdentifyAthlete(athleteId: string): Promise<void> {
  await supabaseAdmin
    .from("athletes")
    .update({
      first_name: "Former",
      last_name: "athlete",
      user_id: null,
      username: null,
      birthdate: null,
      motivation: "",
      guardian_email: null,
      guardian_claim_token: null,
      guardian_claim_code: null,
      invite_recipient: null,
    })
    .eq("id", athleteId);
}

/**
 * Fully erase an athlete who has no account of their own and no remaining
 * guardian. Nobody is left to control this profile, so a de-identified shell
 * would just be orphaned personal data. Tables without a cascading foreign key
 * are cleared first; the athlete row cascades the rest (plans, sessions,
 * coach links, invoices, invites).
 */
async function purgeAthlete(athleteId: string): Promise<void> {
  const { data: rooms } = await supabaseAdmin
    .from("message_rooms")
    .select("id")
    .eq("athlete_id", athleteId);
  const roomIds = (rooms ?? []).map((r) => r.id);
  if (roomIds.length > 0) {
    const { data: audio } = await supabaseAdmin
      .from("messages")
      .select("audio_url")
      .in("room_id", roomIds)
      .not("audio_url", "is", null);
    const paths = (audio ?? []).map((r) => r.audio_url).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const { error } = await supabaseAdmin.storage.from("voice-notes").remove(paths);
      if (error) console.error("[account-deletion] athlete voice note cleanup failed", error);
    }
    await supabaseAdmin.from("messages").delete().in("room_id", roomIds);
    await supabaseAdmin.from("message_rooms").delete().in("id", roomIds);
  }

  await supabaseAdmin.from("plan_sessions").delete().eq("athlete_id", athleteId);
  await supabaseAdmin.from("athlete_goals").delete().eq("athlete_id", athleteId);
  await supabaseAdmin.from("athlete_lesson_slots").delete().eq("athlete_id", athleteId);
  await supabaseAdmin.from("athlete_invite_codes").delete().eq("athlete_id", athleteId);
  await supabaseAdmin.from("athletes").delete().eq("id", athleteId);
}

function isMinor(birthdate: string | null): boolean {
  if (!birthdate) return false;
  const dob = new Date(birthdate);
  const eighteen = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate());
  return eighteen.getTime() > Date.now();
}

/**
 * Athletes under 18 who sign in themselves and whose only guardian is this
 * user — deleting the guardian would leave them with no adult on file.
 */
export async function listOrphanedMinors(userId: string): Promise<OrphanedMinor[]> {
  const { data: parent } = await supabaseAdmin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!parent) return [];

  const { data: athletes } = await supabaseAdmin
    .from("athletes")
    .select("id, first_name, birthdate, user_id, guardian_email")
    .eq("parent_id", parent.id);

  const out: OrphanedMinor[] = [];
  for (const a of athletes ?? []) {
    if (!a.user_id || !isMinor(a.birthdate)) continue;
    const { data: coGuardians } = await supabaseAdmin
      .from("athlete_guardians")
      .select("parent_id")
      .eq("athlete_id", a.id)
      .neq("parent_id", parent.id);
    if ((coGuardians ?? []).length > 0) continue;
    out.push({ id: a.id, firstName: a.first_name, guardianEmail: a.guardian_email });
  }
  return out;
}

export type MinorChoice = { athleteId: string; action: "keep" | "delete" };

export async function deleteAccountForUser(
  userId: string,
  email: string | null,
  initiatedBy: "self" | "admin",
  minorChoices: MinorChoice[] = [],
): Promise<DeletionResult> {
  const choiceFor = new Map(minorChoices.map((c) => [c.athleteId, c.action]));
  let role: DeletionRole = "unknown";
  let athletesDeleted = 0;
  let athletesTransferred = 0;

  await deleteVoiceNotes(userId);

  // ---- Coach ----
  const { data: coach } = await supabaseAdmin
    .from("coach_profiles")
    .select("id, stripe_subscription_id, subscription_environment")
    .eq("user_id", userId)
    .maybeSingle();

  if (coach) {
    role = "coach";
    await cancelSubscription(coach.stripe_subscription_id, coach.subscription_environment);
    await deleteCoachResources(coach.id);
    await supabaseAdmin
      .from("coach_profiles")
      .update({
        user_id: null,
        first_name: "A former",
        last_name: "coach",
      })
      .eq("id", coach.id);
  }

  // ---- Parent ----
  const { data: parent } = await supabaseAdmin
    .from("parent_profiles")
    .select("id, stripe_subscription_id, subscription_environment")
    .eq("user_id", userId)
    .maybeSingle();

  if (parent) {
    role = "parent";
    await cancelSubscription(parent.stripe_subscription_id, parent.subscription_environment);

    const { data: athletes } = await supabaseAdmin
      .from("athletes")
      .select("id, user_id, birthdate")
      .eq("parent_id", parent.id);

    for (const athlete of athletes ?? []) {
      const { data: coGuardians } = await supabaseAdmin
        .from("athlete_guardians")
        .select("parent_id")
        .eq("athlete_id", athlete.id)
        .neq("parent_id", parent.id);
      const successor = (coGuardians ?? [])[0]?.parent_id ?? null;
      if (successor) {
        await supabaseAdmin.from("athletes").update({ parent_id: successor }).eq("id", athlete.id);
        athletesTransferred += 1;
      } else if (athlete.user_id && isMinor(athlete.birthdate)) {
        // Minor with their own sign-in and no other guardian. Either an adult
        // stays reachable on the profile, or the athlete goes too — we never
        // leave a minor with no adult on file. Default is to keep.
        if (choiceFor.get(athlete.id) === "delete") {
          await supabaseAdmin.from("athletes").update({ parent_id: null }).eq("id", athlete.id);
          const athleteUserId = athlete.user_id;
          await purgeAthlete(athlete.id);
          const { error } = await supabaseAdmin.auth.admin.deleteUser(athleteUserId);
          if (error) console.error("[account-deletion] athlete auth delete failed", error);
          athletesDeleted += 1;
        } else {
          // guardian_email stays on file so recaps and copies keep reaching
          // the departing guardian's address.
          await supabaseAdmin.from("athletes").update({ parent_id: null }).eq("id", athlete.id);
        }
      } else if (athlete.user_id) {
        // Adult athlete with their own sign-in: just drop the guardian link.
        await supabaseAdmin
          .from("athletes")
          .update({
            parent_id: null,
            guardian_email: null,
            guardian_claim_token: null,
            guardian_claim_code: null,
            invite_recipient: null,
          })
          .eq("id", athlete.id);
      } else {
        // No successor guardian and no account of their own: nobody is left to
        // control this profile, so erase it rather than leave a shell behind.
        await supabaseAdmin.from("athletes").update({ parent_id: null }).eq("id", athlete.id);
        await purgeAthlete(athlete.id);
        athletesDeleted += 1;
      }
    }

    await supabaseAdmin.from("parent_profiles").delete().eq("id", parent.id);
  }

  // ---- Athlete account (adult / self-managed) ----
  const { data: ownAthletes } = await supabaseAdmin
    .from("athletes")
    .select("id")
    .eq("user_id", userId);

  for (const athlete of ownAthletes ?? []) {
    if (role === "unknown") role = "athlete";
    await deIdentifyAthlete(athlete.id);
  }

  await supabaseAdmin.from("deleted_accounts").insert({
    user_id: userId,
    role,
    initiated_by: initiatedBy,
    email_hash: email ? await sha256Hex(email) : null,
  });

  // Sign in with Apple: revoke Apple's grant before the auth user (and its
  // auth_identities rows, which cascade) disappear. Best-effort — a failed
  // or unconfigured revoke never blocks the deletion.
  try {
    const { revokeAppleIdentitiesForUser } = await import("@/lib/api/auth-broker");
    await revokeAppleIdentitiesForUser(supabaseAdmin, userId);
  } catch (err) {
    console.error("[account-deletion] apple revoke failed", err);
  }

  // Last: removing the auth user tombstones their messages via the DB trigger.
  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (delErr) throw new Error(delErr.message);

  return { role, athletesDeleted, athletesTransferred };
}

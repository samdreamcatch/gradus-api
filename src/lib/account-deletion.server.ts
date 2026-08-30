/**
 * Server-only account deletion. Removes the caller's identity and personal
 * data while keeping shared history (threads, plans, invoices) coherent for
 * the other participants. See the account-deletion plan for the full rules.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DeletionRole = "coach" | "parent" | "athlete" | "unknown";

export type DeletionResult = {
  role: DeletionRole;
  athletesDeleted: number;
  athletesTransferred: number;
};

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

export async function deleteAccountForUser(
  userId: string,
  email: string | null,
  initiatedBy: "self" | "admin",
): Promise<DeletionResult> {
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
      .select("id")
      .eq("parent_id", parent.id);

    for (const athlete of athletes ?? []) {
      const { data: coGuardians } = await supabaseAdmin
        .from("athlete_guardians")
        .select("parent_id")
        .eq("athlete_id", athlete.id)
        .neq("parent_id", parent.id);
      const successor = (coGuardians ?? [])[0]?.parent_id ?? null;
      if (successor) {
        await supabaseAdmin
          .from("athletes")
          .update({ parent_id: successor })
          .eq("id", athlete.id);
        athletesTransferred += 1;
      } else {
        // Detach first so the parent cascade can't take the athlete's shared
        // history (invoices, plans) with it, then de-identify in place.
        await supabaseAdmin.from("athletes").update({ parent_id: null }).eq("id", athlete.id);
        await deIdentifyAthlete(athlete.id);
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

  // Last: removing the auth user tombstones their messages via the DB trigger.
  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (delErr) throw new Error(delErr.message);

  return { role, athletesDeleted, athletesTransferred };
}

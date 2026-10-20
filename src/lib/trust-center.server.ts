import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { policyClient } from "./club-policy-schema";
import { policyDeadline } from "./club-policy";
import { ackRoster, isMinor, type AckAudience, type AckSigner } from "./org-content.server";
import { computeReadiness, type RequirementInput } from "./trust-center";

type Admin = SupabaseClient<Database>;

export type MatrixDoc = {
  resourceId: string;
  title: string;
  version: number;
  audiences: string[];
  sports: string[];
  requiredAt: string;
  dueAt: string | null;
};

export type ClubRequirements = { docs: MatrixDoc[]; signers: Record<string, AckSigner[]> };

/** Every live acknowledgement requirement in the club, with its signer roster. */
export async function clubRequirements(admin: Admin, orgId: string): Promise<ClubRequirements> {
  const reqs = await policyClient(admin)
    .from("club_resource_ack_requirements")
    .select("resource_id, audiences, version, required_at, resources!inner(title)")
    .eq("organization_id", orgId);
  if (reqs.error) dbError(reqs.error);
  const archived = await admin
    .from("org_resource_overrides")
    .select("resource_id")
    .eq("organization_id", orgId)
    .not("archived_at", "is", null);
  if (archived.error) dbError(archived.error);
  const gone = new Set((archived.data ?? []).map((r) => r.resource_id));
  const live = (reqs.data ?? []).filter((r) => !gone.has(r.resource_id) && r.audiences.length);
  const ids = live.map((r) => r.resource_id);
  const sports = ids.length
    ? await admin.from("resource_sports").select("resource_id, sport").in("resource_id", ids)
    : { data: [], error: null };
  if (sports.error) dbError(sports.error);

  const packs = await clubDeadlinePacks(admin, orgId);
  const docs: MatrixDoc[] = [];
  const signers: Record<string, AckSigner[]> = {};
  for (const r of live) {
    docs.push({
      resourceId: r.resource_id,
      title: (r.resources as unknown as { title: string }).title,
      version: r.version,
      audiences: r.audiences,
      sports: (sports.data ?? [])
        .filter((s) => s.resource_id === r.resource_id)
        .map((s) => s.sport),
      requiredAt: r.required_at,
      dueAt: policyDeadline(r.resource_id, packs),
    });
    signers[r.resource_id] = await ackRoster(
      admin,
      orgId,
      r.resource_id,
      r.audiences as AckAudience[],
      r.version,
    );
  }
  docs.sort((a, b) => a.title.localeCompare(b.title));
  return { docs, signers };
}

export async function clubReadiness(admin: Admin, orgId: string) {
  const { docs, signers } = await clubRequirements(admin, orgId);

  const coaches = await admin.from("coach_profiles").select("id").eq("organization_id", orgId);
  if (coaches.error) dbError(coaches.error);
  const coachIds = (coaches.data ?? []).map((c) => c.id);
  const links = coachIds.length
    ? await admin.from("coach_athletes").select("athlete_id").in("coach_id", coachIds)
    : { data: [], error: null };
  if (links.error) dbError(links.error);
  const athleteIds = Array.from(new Set((links.data ?? []).map((l) => l.athlete_id)));
  const athletes = athleteIds.length
    ? await admin.from("athletes").select("id, birthdate, parent_id").in("id", athleteIds)
    : { data: [], error: null };
  if (athletes.error) dbError(athletes.error);
  const guardians = athleteIds.length
    ? await admin.from("athlete_guardians").select("athlete_id").in("athlete_id", athleteIds)
    : { data: [], error: null };
  if (guardians.error) dbError(guardians.error);
  const guarded = new Set((guardians.data ?? []).map((g) => g.athlete_id));
  const minors = (athletes.data ?? [])
    .filter((a) => isMinor(a.birthdate as string | null))
    .map((a) => ({ linkedGuardian: !!a.parent_id || guarded.has(a.id) }));

  const invites = await admin
    .from("org_coach_invites")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
  if (invites.error) dbError(invites.error);

  const held = await admin
    .from("resources")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("is_org_template", true)
    .neq("review_state", "released");
  if (held.error) dbError(held.error);

  const requirements: RequirementInput[] = docs.map((d) => ({
    resourceId: d.resourceId,
    title: d.title,
    sports: d.sports,
    dueAt: d.dueAt,
    signers: (signers[d.resourceId] ?? []).map((s) => ({
      role: s.role,
      key: s.key,
      done: !!s.acknowledgedAt,
    })),
  }));

  return {
    ...computeReadiness({
      coachKeys: coachIds.map((id) => `coach:${id}`),
      requirements,
      minors,
      expiredInvites: invites.count ?? 0,
      heldResources: held.count ?? 0,
    }),
    activity: await clubActivity(admin, orgId, docs),
  };
}

export type ActivityEntry = { at: string; text: string };

async function clubActivity(
  admin: Admin,
  orgId: string,
  docs: MatrixDoc[],
): Promise<ActivityEntry[]> {
  const actions = await admin
    .from("org_admin_actions")
    .select("action, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(15);
  if (actions.error) dbError(actions.error);
  const ids = docs.map((d) => d.resourceId);
  const acks = ids.length
    ? await policyClient(admin)
        .from("club_resource_acknowledgements")
        .select("resource_id, signer_name, acknowledged_at")
        .in("resource_id", ids)
        .eq("organization_id", orgId)
        .order("acknowledged_at", { ascending: false })
        .limit(15)
    : { data: [], error: null };
  if (acks.error) dbError(acks.error);
  const title = (id: string) => docs.find((d) => d.resourceId === id)?.title ?? "a document";
  const out: ActivityEntry[] = [
    ...(actions.data ?? []).map((a) => ({ at: a.created_at, text: humanAction(a.action) })),
    ...(acks.data ?? []).map((a) => ({
      at: a.acknowledged_at,
      text: `${a.signer_name ?? "Someone"} acknowledged "${title(a.resource_id)}"`,
    })),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
}

function humanAction(action: string): string {
  const s = action.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function clubDeadlinePacks(admin: Admin, orgId: string) {
  // Policy packs are additive draft storage; do not simulate success before acceptance.
  const result = await (admin as SupabaseClient)
    .from("policy_packs")
    .select("due_at, policy_pack_items(resource_id)")
    .eq("organization_id", orgId)
    .is("archived_at", null);
  if (result.error) dbError(result.error);
  return (result.data ?? []).map((p) => ({
    dueAt: p.due_at as string | null,
    resourceIds: (p.policy_pack_items as { resource_id: string }[]).map((i) => i.resource_id),
  }));
}

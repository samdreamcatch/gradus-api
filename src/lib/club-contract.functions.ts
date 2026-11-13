import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ClubContract = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  slug: string;
  is_listed: boolean;
  logo_url: string | null;
  coach_seats: number;
  admin_seats: number;
  storefront_share_bps: number;
  storefront_enabled: boolean;
  contract_starts_on: string | null;
  contract_ends_on: string | null;
  contract_signed_on: string | null;
  contract_file_url: string | null;
  contract_seat_rate_cents: number | null;
  contract_currency: string;
};
export type ClubSeat = {
  id: string;
  organization_id: string;
  seat_no: number;
  coach_id: string | null;
  reserved_invite_id: string | null;
  filled_at: string | null;
  released_at: string | null;
  grace_until: string | null;
};
export type ClubAdmin = {
  id: string;
  user_id: string;
  organization_id: string;
  club_role: "owner" | "admin";
  club_title: string | null;
  created_at: string;
};
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type ClubDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      club_remove_admin: { Args: { p_org_id: string; p_admin_id: string }; Returns: undefined };
    };
    Tables: Omit<Database["public"]["Tables"], "organizations" | "org_admins"> & {
      organizations: Table<ClubContract>;
      org_seats: Table<ClubSeat>;
      org_admins: Table<ClubAdmin>;
    };
  };
};
const orgInput = z.object({ organizationId: z.string().uuid() });

async function authorizedClient(
  supabase: SupabaseClient<Database>,
  userId: string,
  organizationId: string,
) {
  const result = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: organizationId });
  if (result.error) dbError(result.error);
  if (!result.data) throw new Error("Not authorized for this club.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient<ClubDatabase>;
}

export const getClubContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await authorizedClient(context.supabase, context.userId, data.organizationId);
    const [club, sports, code, seats, admins] = await Promise.all([
      admin
        .from("organizations")
        .select(
          "id,name,city,region,slug,is_listed,logo_url,coach_seats,admin_seats,storefront_share_bps,storefront_enabled,contract_starts_on,contract_ends_on,contract_signed_on,contract_file_url,contract_seat_rate_cents,contract_currency",
        )
        .eq("id", data.organizationId)
        .single(),
      admin.from("organization_sports").select("sport").eq("organization_id", data.organizationId),
      admin
        .from("organization_invite_codes")
        .select("code")
        .eq("organization_id", data.organizationId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1),
      admin
        .from("org_seats")
        .select(
          "id,organization_id,seat_no,coach_id,reserved_invite_id,filled_at,released_at,grace_until",
        )
        .eq("organization_id", data.organizationId)
        .order("seat_no"),
      admin
        .from("org_admins")
        .select("id,user_id,organization_id,club_role,club_title,created_at")
        .eq("organization_id", data.organizationId)
        .order("created_at"),
    ]);
    for (const result of [club, sports, code, seats, admins])
      if (result.error) dbError(result.error);
    if (!club.data) throw new Error("Club not found.");
    return {
      club: club.data,
      sports: (sports.data ?? []).map((s) => s.sport),
      code: code.data?.[0]?.code ?? null,
      seats: seats.data ?? [],
      admins: admins.data ?? [],
    };
  });

export const updateClubContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        coach_seats: z.number().int().min(0).max(10000),
        admin_seats: z.number().int().min(1).max(1000),
        contract_seat_rate_cents: z.number().int().min(0).max(100000000).nullable(),
        contract_currency: z.string().regex(/^[a-z]{3}$/),
        storefront_share_bps: z.number().int().min(0).max(10000),
        storefront_enabled: z.boolean(),
        contract_starts_on: z.string().date().nullable(),
        contract_ends_on: z.string().date().nullable(),
        contract_signed_on: z.string().date().nullable(),
        contract_file_url: z
          .string()
          .url()
          .refine((value) => value.startsWith("https://"), "Use a secure agreement URL.")
          .nullable(),
      })
      .refine(
        (input) =>
          !input.contract_starts_on ||
          !input.contract_ends_on ||
          input.contract_ends_on >= input.contract_starts_on,
        "Contract end must follow its start.",
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error) dbError(role.error);
    if (!role.data) throw new Error("Only Gradus staff can change contract terms.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient<ClubDatabase>;
    const { organizationId, ...patch } = data;
    const result = await admin
      .from("organizations")
      .update(patch)
      .eq("id", organizationId)
      .select("id")
      .single();
    if (result.error) dbError(result.error);
    return { ok: true };
  });

export const getStaffClubContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error) dbError(role.error);
    if (!role.data) throw new Error("Not authorized.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient<ClubDatabase>;
    const result = await admin
      .from("organizations")
      .select(
        "id,name,city,region,slug,is_listed,logo_url,coach_seats,admin_seats,storefront_share_bps,storefront_enabled,contract_starts_on,contract_ends_on,contract_signed_on,contract_file_url,contract_seat_rate_cents,contract_currency",
      )
      .eq("id", data.organizationId)
      .single();
    if (result.error) dbError(result.error);
    return result.data;
  });

export type ClubSeatRequest = {
  id: string;
  coach_id: string;
  coach_name: string | null;
  requested_at: string;
};

export const listClubSeatRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }): Promise<ClubSeatRequest[]> => {
    const admin = await authorizedClient(context.supabase, context.userId, data.organizationId);
    const result = await (admin as unknown as SupabaseClient)
      .from("club_seat_requests")
      .select("id,coach_id,coach_name,requested_at")
      .eq("organization_id", data.organizationId)
      .is("resolved_at", null)
      .order("requested_at");
    if (result.error) dbError(result.error);
    return (result.data ?? []) as ClubSeatRequest[];
  });

async function clubRpc(
  supabase: SupabaseClient<Database>,
  userId: string,
  organizationId: string,
  fn: string,
  args: Record<string, unknown>,
) {
  const admin = await authorizedClient(supabase, userId, organizationId);
  const result = await (admin as unknown as SupabaseClient).rpc(fn, {
    p_org_id: organizationId,
    p_actor: userId,
    ...args,
  });
  if (result.error) dbError(result.error);
  return { ok: true };
}

export const setClubAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput.extend({ adminId: z.string().uuid(), role: z.enum(["owner", "admin"]) }).parse(input),
  )
  .handler(({ data, context }) =>
    clubRpc(context.supabase, context.userId, data.organizationId, "club_set_admin_role", {
      p_admin_id: data.adminId,
      p_role: data.role,
    }),
  );

export const releaseClubCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.extend({ coachId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    clubRpc(context.supabase, context.userId, data.organizationId, "club_release_coach", {
      p_coach_id: data.coachId,
    }),
  );

export const assignWaitingCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput.extend({ requestId: z.string().uuid() }).parse(input),
  )
  .handler(({ data, context }) =>
    clubRpc(context.supabase, context.userId, data.organizationId, "club_assign_waiting_coach", {
      p_request_id: data.requestId,
    }),
  );

export const removeClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.extend({ adminId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await authorizedClient(context.supabase, context.userId, data.organizationId);
    const result = await admin.rpc("club_remove_admin", {
      p_org_id: data.organizationId,
      p_admin_id: data.adminId,
    });
    if (result.error) dbError(result.error);
    return { ok: true };
  });

export const expandClubContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput
      .extend({
        seats: z.number().int().min(1).max(1000),
        expectedAmount: z.number().int().min(0),
        requestKey: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await authorizedClient(context.supabase, context.userId, data.organizationId);
    const result = await (admin as unknown as SupabaseClient).rpc("club_expand_contract", {
      p_org_id: data.organizationId,
      p_actor: context.userId,
      p_seats: data.seats,
      p_expected_amount: data.expectedAmount,
      p_request_key: data.requestKey,
    });
    if (result.error) dbError(result.error);
    return { id: result.data as string };
  });

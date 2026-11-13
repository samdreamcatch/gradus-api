/**
 * Coach promo codes (migration 20261113120000_coach_promo_codes): a coach
 * makes codes for their marketplace plans, and a buyer applies one when
 * buying (`startPlanCheckout` / `previewPlanPromoCode` in
 * src/lib/plan-purchases.server.ts).
 *
 * A code is unique per coach, percent (1–100) or fixed (USD) off, for all of
 * the coach's plans or a chosen few, optionally limited in total uses, uses
 * per buyer, and dates. The discount is applied on the server: the purchase
 * is charged the discounted amount, and Gradus's 3% comes out of what's paid.
 * A discount covering the whole price makes the plan free.
 *
 * Uses are counted from plan_purchases: every purchase that applied the code
 * and was delivered (or is being delivered, or was later restricted). A
 * checkout still open doesn't count until it's paid.
 *
 * `coach_promo_codes` isn't in the generated types until Lovable regenerates
 * them, so it goes through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Admin = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = { from: (table: string) => any };
const untyped = (client: Admin) => client as unknown as Untyped;

export type PromoCodesContext = { userId: string; admin: Admin };

/** Stripe's smallest USD charge: a discount may not leave less than this (other than free). */
export const MIN_CHARGE_CENTS = 50;

/** Purchase statuses that count as a use of the code. */
const REDEEMED_STATUSES = ["fulfilling", "fulfilled", "restricted"];

export type PromoDiscountType = "percent" | "fixed";

/** What the coach sees: `active` (usable now), `paused`, `scheduled`, `expired`, `used_up`. */
export type PromoCodeState = "active" | "paused" | "scheduled" | "expired" | "used_up";

export interface CoachPromoCodeDTO {
  id: string;
  code: string;
  discountType: PromoDiscountType;
  /** percent: 1–100; fixed: USD. */
  discountValue: number;
  /** The coach's plans it applies to; null is all of them. */
  planIds: string[] | null;
  /** null is unlimited. */
  maxRedemptions: number | null;
  /** Uses per buyer; null is unlimited. */
  maxPerUser: number | null;
  redemptionCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  state: PromoCodeState;
  createdAt: string;
  updatedAt: string;
}

type PromoRow = {
  id: string;
  coach_id: string;
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number | string;
  plan_ids: string[] | null;
  max_redemptions: number | null;
  max_per_user: number | null;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const PROMO_COLUMNS =
  "id, coach_id, code, discount_type, discount_value, plan_ids, max_redemptions, max_per_user, starts_at, expires_at, active, created_at, updated_at";

/** Codes are typed any case; stored and matched upper-case. */
export const normalizePromoCode = (code: string) => code.trim().toUpperCase();

const codeField = z
  .string()
  .trim()
  .transform(normalizePromoCode)
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9_-]{3,32}$/,
        "Use 3–32 letters, numbers, dashes or underscores, with no spaces.",
      ),
  );

const promoFields = {
  code: codeField,
  discountType: z.enum(["percent", "fixed"]),
  /** percent: 1–100; fixed: USD off. Up to two decimals. */
  discountValue: z.number().positive().max(100_000).multipleOf(0.01),
  /** null (or left out) is all of the coach's plans. */
  planIds: z.array(z.string().uuid()).min(1).max(200).nullable(),
  maxRedemptions: z.number().int().positive().nullable(),
  maxPerUser: z.number().int().positive().nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  active: z.boolean(),
};

export const createPromoCodeInput = z.object({
  ...promoFields,
  planIds: promoFields.planIds.optional().default(null),
  maxRedemptions: promoFields.maxRedemptions.optional().default(null),
  maxPerUser: promoFields.maxPerUser.optional().default(1),
  startsAt: promoFields.startsAt.optional().default(null),
  expiresAt: promoFields.expiresAt.optional().default(null),
  active: promoFields.active.optional().default(true),
});

/** Any of the fields; the rules that span fields are checked against the saved code. */
export const updatePromoCodeInput = z
  .object(promoFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const applyPromoCodeInput = z.object({ code: z.string().trim().min(1).max(64) });

const invalid = (message: string) =>
  new ApiError({ code: "validation_failed", status: 400, message });

const promoNotFound = () =>
  new ApiError({ code: "not_found", status: 404, message: "Promo code not found." });

/** The rules across fields: a percent of at most 100, and an end after the start. */
function checkPromoRules(p: {
  discount_type: PromoDiscountType;
  discount_value: number;
  starts_at: string | null;
  expires_at: string | null;
}) {
  if (p.discount_type === "percent" && p.discount_value > 100) {
    throw invalid("A percent discount can be at most 100.");
  }
  if (p.starts_at && p.expires_at && new Date(p.expires_at) <= new Date(p.starts_at)) {
    throw invalid("The end date must be after the start date.");
  }
}

async function callerCoachId(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data)
    throw new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });
  return data.id as string;
}

/** Every plan named is the coach's own. */
async function checkOwnPlans(admin: Admin, coachId: string, planIds: string[] | null) {
  if (!planIds) return;
  const unique = [...new Set(planIds)];
  const { data, error } = await untyped(admin)
    .from("plans")
    .select("id")
    .eq("coach_id", coachId)
    .in("id", unique);
  if (error) dbError(error);
  if (((data ?? []) as unknown[]).length !== unique.length) {
    throw invalid("A promo code can only apply to your own plans.");
  }
}

/** Uses per code, from the purchases that applied it. */
async function redemptionCounts(admin: Admin, promoIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (promoIds.length === 0) return counts;
  const { data, error } = await untyped(admin)
    .from("plan_purchases")
    .select("promo_code_id")
    .in("promo_code_id", promoIds)
    .in("status", REDEEMED_STATUSES);
  if (error) dbError(error);
  for (const r of (data ?? []) as { promo_code_id: string }[]) {
    counts.set(r.promo_code_id, (counts.get(r.promo_code_id) ?? 0) + 1);
  }
  return counts;
}

export function promoState(
  row: PromoRow,
  redemptionCount: number,
  now = new Date(),
): PromoCodeState {
  if (!row.active) return "paused";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (row.starts_at && new Date(row.starts_at) > now) return "scheduled";
  if (row.max_redemptions !== null && redemptionCount >= row.max_redemptions) return "used_up";
  return "active";
}

const toDTO = (row: PromoRow, redemptionCount: number): CoachPromoCodeDTO => ({
  id: row.id,
  code: row.code,
  discountType: row.discount_type,
  discountValue: Number(row.discount_value),
  planIds: row.plan_ids,
  maxRedemptions: row.max_redemptions,
  maxPerUser: row.max_per_user,
  redemptionCount,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
  active: row.active,
  state: promoState(row, redemptionCount),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";
const codeTaken = () =>
  new ApiError({
    code: "promo_code_taken",
    status: 409,
    message: "You already have a promo code with this name.",
  });

/** `GET /api/v1/coach/promo-codes`: the caller's codes, newest first, with their uses. */
export async function listCoachPromoCodes(
  ctx: PromoCodesContext,
): Promise<{ items: CoachPromoCodeDTO[] }> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const { data, error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .select(PROMO_COLUMNS)
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });
  if (error) dbError(error);
  const rows = (data ?? []) as PromoRow[];
  const counts = await redemptionCounts(
    ctx.admin,
    rows.map((r) => r.id),
  );
  return { items: rows.map((r) => toDTO(r, counts.get(r.id) ?? 0)) };
}

/** `POST /api/v1/coach/promo-codes`. 409 `promo_code_taken` when the coach already has the code. */
export async function createCoachPromoCode(
  ctx: PromoCodesContext,
  input: z.infer<typeof createPromoCodeInput>,
): Promise<CoachPromoCodeDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const row = {
    coach_id: coachId,
    code: input.code,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    plan_ids: input.planIds,
    max_redemptions: input.maxRedemptions,
    max_per_user: input.maxPerUser,
    starts_at: input.startsAt,
    expires_at: input.expiresAt,
    active: input.active,
  };
  checkPromoRules(row);
  await checkOwnPlans(ctx.admin, coachId, input.planIds);

  const { data, error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .insert(row)
    .select(PROMO_COLUMNS)
    .single();
  if (isUniqueViolation(error)) throw codeTaken();
  if (error) dbError(error, "Couldn't save this promo code");
  return toDTO(data as PromoRow, 0);
}

async function ownPromoRow(admin: Admin, coachId: string, id: string): Promise<PromoRow> {
  const { data, error } = await untyped(admin)
    .from("coach_promo_codes")
    .select(PROMO_COLUMNS)
    .eq("id", id)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw promoNotFound();
  return data as PromoRow;
}

/**
 * `PATCH /api/v1/coach/promo-codes/{id}`: any of its fields. Purchases that
 * already applied it keep what they paid.
 */
export async function updateCoachPromoCode(
  ctx: PromoCodesContext,
  id: string,
  input: z.infer<typeof updatePromoCodeInput>,
): Promise<CoachPromoCodeDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const current = await ownPromoRow(ctx.admin, coachId, id);

  const patch: Record<string, unknown> = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.discountType !== undefined) patch.discount_type = input.discountType;
  if (input.discountValue !== undefined) patch.discount_value = input.discountValue;
  if (input.planIds !== undefined) patch.plan_ids = input.planIds;
  if (input.maxRedemptions !== undefined) patch.max_redemptions = input.maxRedemptions;
  if (input.maxPerUser !== undefined) patch.max_per_user = input.maxPerUser;
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (input.active !== undefined) patch.active = input.active;

  const merged = { ...current, ...patch } as PromoRow;
  checkPromoRules({ ...merged, discount_value: Number(merged.discount_value) });
  if (input.planIds !== undefined) await checkOwnPlans(ctx.admin, coachId, input.planIds);

  const { data, error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .update(patch)
    .eq("id", id)
    .eq("coach_id", coachId)
    .select(PROMO_COLUMNS)
    .single();
  if (isUniqueViolation(error)) throw codeTaken();
  if (error) dbError(error, "Couldn't save this promo code");
  const counts = await redemptionCounts(ctx.admin, [id]);
  return toDTO(data as PromoRow, counts.get(id) ?? 0);
}

/**
 * `DELETE /api/v1/coach/promo-codes/{id}`. Purchases that applied it keep the
 * code's name and what they paid; to stop new uses but keep the history in
 * the list, pause it instead (`active: false`).
 */
export async function deleteCoachPromoCode(
  ctx: PromoCodesContext,
  id: string,
): Promise<{ ok: true }> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  await ownPromoRow(ctx.admin, coachId, id);
  const { error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .delete()
    .eq("id", id)
    .eq("coach_id", coachId);
  if (error) dbError(error, "Couldn't delete this promo code");
  return { ok: true };
}

/** The price after a discount, in cents, never below 0. */
export function discountedCents(
  originalCents: number,
  discountType: PromoDiscountType,
  discountValue: number,
): number {
  const off =
    discountType === "percent"
      ? Math.round((originalCents * discountValue) / 100)
      : Math.round(discountValue * 100);
  return Math.max(0, originalCents - off);
}

export interface AppliedPromo {
  promoCodeId: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  originalAmountCents: number;
  discountCents: number;
  /** What the buyer pays. */
  amountCents: number;
}

const promoRefused = (code: string, message: string) =>
  new ApiError({ code, status: 422, message });

/**
 * The coach's code applied to one of their plans for `buyerUserId`, or why it
 * can't be: 404 `promo_code_invalid` (no such code, paused, or not started),
 * 422 `promo_code_expired`, `promo_code_not_applicable` (another plan, or a
 * free one), `promo_code_used_up`, `promo_code_already_used` (this buyer's
 * limit), `promo_code_below_minimum` (would leave less than Stripe's $0.50
 * but more than free).
 */
export async function resolvePromoForPlan(
  admin: Admin,
  args: {
    coachId: string;
    planId: string;
    originalAmountCents: number;
    buyerUserId: string;
    code: string;
  },
  now: Date = new Date(),
): Promise<AppliedPromo> {
  const { data, error } = await untyped(admin)
    .from("coach_promo_codes")
    .select(PROMO_COLUMNS)
    .eq("coach_id", args.coachId)
    .eq("code", normalizePromoCode(args.code))
    .maybeSingle();
  if (error) dbError(error);
  const row = data as PromoRow | null;
  if (!row || !row.active || (row.starts_at && new Date(row.starts_at) > now)) {
    throw new ApiError({
      code: "promo_code_invalid",
      status: 404,
      message: "This promo code isn't valid.",
    });
  }
  if (row.expires_at && new Date(row.expires_at) <= now) {
    throw promoRefused("promo_code_expired", "This promo code has expired.");
  }
  if (row.plan_ids && !row.plan_ids.includes(args.planId)) {
    throw promoRefused("promo_code_not_applicable", "This promo code doesn't apply to this plan.");
  }
  if (args.originalAmountCents === 0) {
    throw promoRefused("promo_code_not_applicable", "This plan is already free.");
  }

  if (row.max_redemptions !== null || row.max_per_user !== null) {
    const { data: uses, error: usesError } = await untyped(admin)
      .from("plan_purchases")
      .select("buyer_user_id")
      .eq("promo_code_id", row.id)
      .in("status", REDEEMED_STATUSES);
    if (usesError) dbError(usesError);
    const all = (uses ?? []) as { buyer_user_id: string }[];
    if (row.max_redemptions !== null && all.length >= row.max_redemptions) {
      throw promoRefused("promo_code_used_up", "This promo code has been used up.");
    }
    const mine = all.filter((u) => u.buyer_user_id === args.buyerUserId).length;
    if (row.max_per_user !== null && mine >= row.max_per_user) {
      throw promoRefused("promo_code_already_used", "You've already used this promo code.");
    }
  }

  const discountValue = Number(row.discount_value);
  const amountCents = discountedCents(args.originalAmountCents, row.discount_type, discountValue);
  if (amountCents > 0 && amountCents < MIN_CHARGE_CENTS) {
    throw promoRefused(
      "promo_code_below_minimum",
      "This promo code can't be used on this plan: it leaves less than $0.50 to pay.",
    );
  }
  return {
    promoCodeId: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue,
    originalAmountCents: args.originalAmountCents,
    discountCents: args.originalAmountCents - amountCents,
    amountCents,
  };
}

/**
 * Coach promo codes (migration 20261113120000_coach_promo_codes): a coach
 * makes codes for their marketplace plans, and a buyer applies one when
 * buying (`startPlanCheckout` / `previewPlanPromoCode` in
 * src/lib/plan-purchases.server.ts).
 *
 * Shaped like the app's "New promo code" sheet: a code unique per coach,
 * % off (1–100), $ off, or Free, for all of the coach's plans or one, a
 * number of uses (1–999), and an optional end date. Each buyer may use a code
 * once. The discount is applied on the server: the purchase is charged the
 * discounted amount, and Gradus's 3% comes out of what's paid. A discount
 * covering the whole price makes the plan free.
 *
 * Uses are counted from plan_purchases: every purchase that applied the code
 * and was delivered (or is being delivered, or was later restricted). A
 * checkout still open doesn't count until it's paid. Revenue is what buyers
 * paid on those purchases once paid.
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

/** How many times one buyer may use a code. */
export const USES_PER_BUYER = 1;

/** Purchase statuses that count as a use of the code. */
const REDEEMED_STATUSES = ["fulfilling", "fulfilled", "restricted"];

export type PromoDiscountType = "percent" | "fixed" | "free";

/**
 * What the coach sees: `active` (usable), `disabled` (turned off),
 * `expired` (past its end date), `used_up` (no uses left). The app's Ended
 * tab is everything not active.
 */
export type PromoCodeState = "active" | "disabled" | "expired" | "used_up";

export interface CoachPromoCodeDTO {
  id: string;
  code: string;
  discountType: PromoDiscountType;
  /** percent: 1–100; fixed: USD; free: null. */
  discountValue: number | null;
  /** The one plan it applies to; null is all of the coach's plans. */
  plan: { id: string; title: string } | null;
  maxRedemptions: number;
  /** Purchases delivered with it. */
  redemptionCount: number;
  /** What buyers paid with it, on paid purchases. */
  revenueCents: number;
  expiresAt: string | null;
  /** false: the coach turned it off. */
  active: boolean;
  /** Usable now: the app's Active tab. */
  isActive: boolean;
  state: PromoCodeState;
  createdAt: string;
  updatedAt: string;
}

type PromoRow = {
  id: string;
  coach_id: string;
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number | string | null;
  plan_id: string | null;
  plan: { id: string; title: string | null } | null;
  max_redemptions: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const PROMO_COLUMNS =
  "id, coach_id, code, discount_type, discount_value, plan_id, plan:plans(id, title), max_redemptions, expires_at, active, created_at, updated_at";

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
  /** percent: % off; fixed: $ off; free: the plan costs nothing. */
  discountType: z.enum(["percent", "fixed", "free"]),
  /** percent: 1–100; fixed: USD off, up to two decimals; free: leave out. */
  discountValue: z.number().positive().max(100_000).multipleOf(0.01).nullable(),
  /** One of the coach's plans; null (or left out) is all of them. */
  planId: z.string().uuid().nullable(),
  /** Total uses, 1–999. */
  maxRedemptions: z.number().int().min(1).max(999),
  /** Optional end date. */
  expiresAt: z.string().datetime({ offset: true }).nullable(),
};

export const createPromoCodeInput = z.object({
  ...promoFields,
  discountValue: promoFields.discountValue.optional().default(null),
  planId: promoFields.planId.optional().default(null),
  expiresAt: promoFields.expiresAt.optional().default(null),
});

/** Any of the fields, or `active: false` to disable the code. Rules spanning fields are checked against the saved code. */
export const updatePromoCodeInput = z
  .object({ ...promoFields, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const applyPromoCodeInput = z.object({ code: z.string().trim().min(1).max(64) });

const invalid = (message: string) =>
  new ApiError({ code: "validation_failed", status: 400, message });

const promoNotFound = () =>
  new ApiError({ code: "not_found", status: 404, message: "Promo code not found." });

/** The value matches the type: none for free, 1–100 for percent, more than 0 for fixed. */
function checkDiscount(type: PromoDiscountType, value: number | null) {
  if (type === "free") return;
  if (value === null) throw invalid("Enter how much the code takes off.");
  if (type === "percent" && value > 100) throw invalid("A percent discount can be at most 100.");
}

function checkExpiry(expiresAt: string | null, now: Date) {
  if (expiresAt && new Date(expiresAt) <= now) {
    throw invalid("The end date must be in the future.");
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

/** The plan named is the coach's own. */
async function checkOwnPlan(admin: Admin, coachId: string, planId: string | null) {
  if (!planId) return;
  const { data, error } = await untyped(admin)
    .from("plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw invalid("A promo code can only apply to your own plans.");
}

type Usage = { count: number; revenueCents: number };

/** Uses and revenue per code, from the purchases that applied it. */
async function usageByCode(admin: Admin, promoIds: string[]): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  if (promoIds.length === 0) return usage;
  const { data, error } = await untyped(admin)
    .from("plan_purchases")
    .select("promo_code_id, amount_cents, payment_status")
    .in("promo_code_id", promoIds)
    .in("status", REDEEMED_STATUSES);
  if (error) dbError(error);
  for (const r of (data ?? []) as {
    promo_code_id: string;
    amount_cents: number;
    payment_status: string | null;
  }[]) {
    const u = usage.get(r.promo_code_id) ?? { count: 0, revenueCents: 0 };
    u.count += 1;
    if (r.payment_status === "paid") u.revenueCents += r.amount_cents;
    usage.set(r.promo_code_id, u);
  }
  return usage;
}

export function promoState(
  row: PromoRow,
  redemptionCount: number,
  now = new Date(),
): PromoCodeState {
  if (!row.active) return "disabled";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (redemptionCount >= row.max_redemptions) return "used_up";
  return "active";
}

const toDTO = (row: PromoRow, usage: Usage | undefined, now = new Date()): CoachPromoCodeDTO => {
  const redemptionCount = usage?.count ?? 0;
  const state = promoState(row, redemptionCount, now);
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value === null ? null : Number(row.discount_value),
    plan: row.plan ? { id: row.plan.id, title: row.plan.title ?? "Untitled plan" } : null,
    maxRedemptions: row.max_redemptions,
    redemptionCount,
    revenueCents: usage?.revenueCents ?? 0,
    expiresAt: row.expires_at,
    active: row.active,
    isActive: state === "active",
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";
const codeTaken = () =>
  new ApiError({
    code: "promo_code_taken",
    status: 409,
    message: "You already have a promo code with this name.",
  });

async function coachPromoRows(admin: Admin, coachId: string): Promise<PromoRow[]> {
  const { data, error } = await untyped(admin)
    .from("coach_promo_codes")
    .select(PROMO_COLUMNS)
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });
  if (error) dbError(error);
  return (data ?? []) as PromoRow[];
}

/** `GET /api/v1/coach/promo-codes`: the caller's codes, newest first, with their uses and revenue. */
export async function listCoachPromoCodes(
  ctx: PromoCodesContext,
  now: Date = new Date(),
): Promise<{ items: CoachPromoCodeDTO[] }> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const rows = await coachPromoRows(ctx.admin, coachId);
  const usage = await usageByCode(
    ctx.admin,
    rows.map((r) => r.id),
  );
  return { items: rows.map((r) => toDTO(r, usage.get(r.id), now)) };
}

/** For the seller dashboard: how many of the coach's codes are usable now, of all they have. */
export async function promoCodeCounts(
  admin: Admin,
  coachId: string,
  now: Date = new Date(),
): Promise<{ active: number; total: number }> {
  const rows = await coachPromoRows(admin, coachId);
  const usage = await usageByCode(
    admin,
    rows.map((r) => r.id),
  );
  return {
    active: rows.filter((r) => promoState(r, usage.get(r.id)?.count ?? 0, now) === "active").length,
    total: rows.length,
  };
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

/** `GET /api/v1/coach/promo-codes/{id}`: one of the caller's codes, with its uses and revenue. */
export async function getCoachPromoCode(
  ctx: PromoCodesContext,
  id: string,
): Promise<CoachPromoCodeDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const row = await ownPromoRow(ctx.admin, coachId, id);
  const usage = await usageByCode(ctx.admin, [id]);
  return toDTO(row, usage.get(id));
}

/** `POST /api/v1/coach/promo-codes`. 409 `promo_code_taken` when the coach already has the code. */
export async function createCoachPromoCode(
  ctx: PromoCodesContext,
  input: z.infer<typeof createPromoCodeInput>,
  now: Date = new Date(),
): Promise<CoachPromoCodeDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const discountValue = input.discountType === "free" ? null : input.discountValue;
  checkDiscount(input.discountType, discountValue);
  checkExpiry(input.expiresAt, now);
  await checkOwnPlan(ctx.admin, coachId, input.planId);

  const { data, error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .insert({
      coach_id: coachId,
      code: input.code,
      discount_type: input.discountType,
      discount_value: discountValue,
      plan_id: input.planId,
      max_redemptions: input.maxRedemptions,
      expires_at: input.expiresAt,
    })
    .select(PROMO_COLUMNS)
    .single();
  if (isUniqueViolation(error)) throw codeTaken();
  if (error) dbError(error, "Couldn't save this promo code");
  return toDTO(data as PromoRow, undefined, now);
}

/**
 * `PATCH /api/v1/coach/promo-codes/{id}`: any of its fields; `active: false`
 * disables it. Purchases that already applied it keep what they paid.
 */
export async function updateCoachPromoCode(
  ctx: PromoCodesContext,
  id: string,
  input: z.infer<typeof updatePromoCodeInput>,
  now: Date = new Date(),
): Promise<CoachPromoCodeDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const current = await ownPromoRow(ctx.admin, coachId, id);

  const patch: Record<string, unknown> = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.discountType !== undefined) patch.discount_type = input.discountType;
  if (input.discountValue !== undefined) patch.discount_value = input.discountValue;
  if (input.planId !== undefined) patch.plan_id = input.planId;
  if (input.maxRedemptions !== undefined) patch.max_redemptions = input.maxRedemptions;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (input.active !== undefined) patch.active = input.active;

  const type = (patch.discount_type as PromoDiscountType | undefined) ?? current.discount_type;
  // A free code has no value: switching to free clears it.
  if (type === "free") patch.discount_value = null;
  const value =
    patch.discount_value !== undefined
      ? (patch.discount_value as number | null)
      : current.discount_value === null
        ? null
        : Number(current.discount_value);
  checkDiscount(type, value);
  if (input.expiresAt !== undefined) checkExpiry(input.expiresAt, now);
  if (input.planId !== undefined) await checkOwnPlan(ctx.admin, coachId, input.planId);

  const { data, error } = await untyped(ctx.admin)
    .from("coach_promo_codes")
    .update(patch)
    .eq("id", id)
    .eq("coach_id", coachId)
    .select(PROMO_COLUMNS)
    .single();
  if (isUniqueViolation(error)) throw codeTaken();
  if (error) dbError(error, "Couldn't save this promo code");
  const usage = await usageByCode(ctx.admin, [id]);
  return toDTO(data as PromoRow, usage.get(id), now);
}

/**
 * `DELETE /api/v1/coach/promo-codes/{id}`. Purchases that applied it keep the
 * code's name and what they paid; to keep it in the list, disable it instead.
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
  discountValue: number | null,
): number {
  if (discountType === "free") return 0;
  const value = discountValue ?? 0;
  const off =
    discountType === "percent"
      ? Math.round((originalCents * value) / 100)
      : Math.round(value * 100);
  return Math.max(0, originalCents - off);
}

export interface AppliedPromo {
  promoCodeId: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number | null;
  originalAmountCents: number;
  discountCents: number;
  /** What the buyer pays. */
  amountCents: number;
}

/**
 * What a buyer's code check comes to: `valid`, or why not: `invalid` (no
 * such code, or disabled), `expired`, `exhausted` (no uses left),
 * `wrong_plan` (another plan, or this plan is free), `already_used` (by this
 * buyer), `below_minimum` (would leave less than Stripe's $0.50, but more
 * than free).
 */
export type PromoCheckState =
  | "valid"
  | "invalid"
  | "expired"
  | "exhausted"
  | "wrong_plan"
  | "already_used"
  | "below_minimum";

export type PromoCheck =
  | { state: "valid"; promo: AppliedPromo }
  | { state: Exclude<PromoCheckState, "valid">; message: string };

const refused = (state: Exclude<PromoCheckState, "valid">, message: string): PromoCheck => ({
  state,
  message,
});

/** The coach's code checked against one of their plans for `buyerUserId`. Changes nothing. */
export async function checkPromoForPlan(
  admin: Admin,
  args: {
    coachId: string;
    planId: string;
    originalAmountCents: number;
    buyerUserId: string;
    code: string;
  },
  now: Date = new Date(),
): Promise<PromoCheck> {
  const { data, error } = await untyped(admin)
    .from("coach_promo_codes")
    .select(PROMO_COLUMNS)
    .eq("coach_id", args.coachId)
    .eq("code", normalizePromoCode(args.code))
    .maybeSingle();
  if (error) dbError(error);
  const row = data as PromoRow | null;
  if (!row || !row.active) return refused("invalid", "This promo code isn't valid.");
  if (row.expires_at && new Date(row.expires_at) <= now) {
    return refused("expired", "This promo code has expired.");
  }
  if (row.plan_id && row.plan_id !== args.planId) {
    return refused("wrong_plan", "This promo code doesn't apply to this plan.");
  }
  if (args.originalAmountCents === 0) return refused("wrong_plan", "This plan is already free.");

  const { data: uses, error: usesError } = await untyped(admin)
    .from("plan_purchases")
    .select("buyer_user_id")
    .eq("promo_code_id", row.id)
    .in("status", REDEEMED_STATUSES);
  if (usesError) dbError(usesError);
  const all = (uses ?? []) as { buyer_user_id: string }[];
  if (all.length >= row.max_redemptions) {
    return refused("exhausted", "This promo code has been used up.");
  }
  if (all.filter((u) => u.buyer_user_id === args.buyerUserId).length >= USES_PER_BUYER) {
    return refused("already_used", "You've already used this promo code.");
  }

  const discountValue = row.discount_value === null ? null : Number(row.discount_value);
  const amountCents = discountedCents(args.originalAmountCents, row.discount_type, discountValue);
  if (amountCents > 0 && amountCents < MIN_CHARGE_CENTS) {
    return refused(
      "below_minimum",
      "This promo code can't be used on this plan: it leaves less than $0.50 to pay.",
    );
  }
  return {
    state: "valid",
    promo: {
      promoCodeId: row.id,
      code: row.code,
      discountType: row.discount_type,
      discountValue,
      originalAmountCents: args.originalAmountCents,
      discountCents: args.originalAmountCents - amountCents,
      amountCents,
    },
  };
}

/** The API error each refusal becomes at checkout. */
const REFUSAL_ERRORS: Record<
  Exclude<PromoCheckState, "valid">,
  { code: string; status: number }
> = {
  invalid: { code: "promo_code_invalid", status: 404 },
  expired: { code: "promo_code_expired", status: 422 },
  exhausted: { code: "promo_code_used_up", status: 422 },
  wrong_plan: { code: "promo_code_not_applicable", status: 422 },
  already_used: { code: "promo_code_already_used", status: 422 },
  below_minimum: { code: "promo_code_below_minimum", status: 422 },
};

/**
 * As `checkPromoForPlan`, for checkout: the applied code, or an error. 404
 * `promo_code_invalid`; 422 `promo_code_expired`, `promo_code_used_up`,
 * `promo_code_not_applicable`, `promo_code_already_used`,
 * `promo_code_below_minimum`.
 */
export async function resolvePromoForPlan(
  admin: Admin,
  args: Parameters<typeof checkPromoForPlan>[1],
  now: Date = new Date(),
): Promise<AppliedPromo> {
  const check = await checkPromoForPlan(admin, args, now);
  if (check.state === "valid") return check.promo;
  throw new ApiError({ ...REFUSAL_ERRORS[check.state], message: check.message });
}

/**
 * Admin › Marketplace: read-only views over data the marketplace already
 * records (plan_purchases, plans, plan_reports, plan_ratings, coach Stripe
 * Connect flags). Server-only; callers must already be admins
 * (`admin-marketplace.functions.ts` checks).
 *
 * Money is in cents. A "sale" is a purchase the buyer paid for (payment_status
 * paid, or a pre-payment-status row that was delivered) and that wasn't
 * canceled. "Held" is what a coach is owed but hasn't received: purchases
 * waiting on the coach's payout setup or on the buyer's payment, plus paid
 * purchases whose transfer to the coach hasn't gone out.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbError } from "./db-error";
import { isDefaultPlanMedia, listingCoverUrls } from "./plan-marketplace-fields.server";
import { signedCoachPhotoUrl } from "./coach-photo.server";

type Admin = any;

export type PaymentStatus = "awaiting_coach_setup" | "payment_due" | "processing" | "paid";

export type PurchaseRow = {
  id: string;
  plan_id: string | null;
  coach_id: string | null;
  buyer_user_id: string | null;
  athlete_id: string | null;
  copied_plan_id: string | null;
  amount_cents: number | null;
  original_amount_cents: number | null;
  currency: string | null;
  platform_fee_cents: number | null;
  stripe_fee_cents: number | null;
  coach_payout_cents: number | null;
  status: string;
  payment_status: PaymentStatus | null;
  payment_due_at: string | null;
  paid_at: string | null;
  promo_code: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_transfer_id: string | null;
  created_at: string;
};

const PURCHASE_COLUMNS =
  "id, plan_id, coach_id, buyer_user_id, athlete_id, copied_plan_id, amount_cents, original_amount_cents, currency, platform_fee_cents, stripe_fee_cents, coach_payout_cents, status, payment_status, payment_due_at, paid_at, promo_code, stripe_checkout_session_id, stripe_payment_intent_id, stripe_transfer_id, created_at";

/** Gradus keeps 3% of each sale (the seller screen's "97% to you"). */
export const PLATFORM_FEE_RATE = 0.03;

// ---------- pure helpers (unit tested) ----------

export function paymentStatusOf(
  row: Pick<PurchaseRow, "payment_status" | "status">,
): PaymentStatus {
  return row.payment_status ?? (row.status === "fulfilled" ? "paid" : "payment_due");
}

export function isSale(row: PurchaseRow): boolean {
  return (
    row.status !== "canceled" &&
    row.status !== "pending" &&
    paymentStatusOf(row) === "paid" &&
    (row.amount_cents ?? 0) > 0
  );
}

/** Free plans the buyer "bought" for $0 (or with a 100% code): delivered, no money. */
export function isFreeClaim(row: PurchaseRow): boolean {
  return row.status !== "canceled" && row.status !== "pending" && (row.amount_cents ?? 0) === 0;
}

/** What the coach gets from a purchase: the recorded payout, else the price less Gradus's 3%. */
export function coachShareCents(row: PurchaseRow): number {
  if (row.coach_payout_cents != null) return row.coach_payout_cents;
  const amount = row.amount_cents ?? 0;
  return amount - Math.round(amount * PLATFORM_FEE_RATE);
}

export type HeldKind = "awaiting_coach_setup" | "payment_due" | "not_transferred";

/** Why this purchase's money hasn't reached the coach, or null when it has (or never will). */
export function heldKind(row: PurchaseRow): HeldKind | null {
  if (row.status === "canceled" || (row.amount_cents ?? 0) <= 0) return null;
  const pay = paymentStatusOf(row);
  if (pay === "awaiting_coach_setup") return "awaiting_coach_setup";
  if (pay === "payment_due" || pay === "processing")
    return row.status === "pending" ? null : "payment_due";
  if (pay === "paid" && !row.stripe_transfer_id && coachShareCents(row) > 0)
    return "not_transferred";
  return null;
}

export type SalesSummary = {
  sales: number;
  freeClaims: number;
  grossCents: number;
  platformFeeCents: number;
  stripeFeeCents: number;
  coachPayoutCents: number;
  discountCents: number;
};

export function summarizeSales(rows: PurchaseRow[]): SalesSummary {
  const out: SalesSummary = {
    sales: 0,
    freeClaims: 0,
    grossCents: 0,
    platformFeeCents: 0,
    stripeFeeCents: 0,
    coachPayoutCents: 0,
    discountCents: 0,
  };
  for (const r of rows) {
    if (isFreeClaim(r)) out.freeClaims += 1;
    if (!isSale(r)) continue;
    const amount = r.amount_cents ?? 0;
    out.sales += 1;
    out.grossCents += amount;
    out.platformFeeCents += r.platform_fee_cents ?? Math.round(amount * PLATFORM_FEE_RATE);
    out.stripeFeeCents += r.stripe_fee_cents ?? 0;
    out.coachPayoutCents += coachShareCents(r);
    if (r.original_amount_cents != null && r.original_amount_cents > amount) {
      out.discountCents += r.original_amount_cents - amount;
    }
  }
  return out;
}

export type HeldSummary = {
  count: number;
  cents: number;
  byKind: Record<HeldKind, { count: number; cents: number }>;
};

export function summarizeHeld(rows: PurchaseRow[]): HeldSummary {
  const byKind: HeldSummary["byKind"] = {
    awaiting_coach_setup: { count: 0, cents: 0 },
    payment_due: { count: 0, cents: 0 },
    not_transferred: { count: 0, cents: 0 },
  };
  let count = 0;
  let cents = 0;
  for (const r of rows) {
    const kind = heldKind(r);
    if (!kind) continue;
    const share = coachShareCents(r);
    byKind[kind].count += 1;
    byKind[kind].cents += share;
    count += 1;
    cents += share;
  }
  return { count, cents, byKind };
}

export type PromoUse = { code: string; uses: number; discountCents: number; grossCents: number };

/** Promo codes used on purchases that went through (paid or free), most used first. */
export function promoUsage(rows: PurchaseRow[]): PromoUse[] {
  const map = new Map<string, PromoUse>();
  for (const r of rows) {
    if (!r.promo_code || r.status === "canceled" || r.status === "pending") continue;
    const code = r.promo_code.toUpperCase();
    const entry = map.get(code) ?? { code, uses: 0, discountCents: 0, grossCents: 0 };
    const amount = r.amount_cents ?? 0;
    entry.uses += 1;
    entry.grossCents += amount;
    if (r.original_amount_cents != null && r.original_amount_cents > amount) {
      entry.discountCents += r.original_amount_cents - amount;
    }
    map.set(code, entry);
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses || b.discountCents - a.discountCents);
}

export type PlanSales = { planId: string; sales: number; grossCents: number; freeClaims: number };

export function salesByPlan(rows: PurchaseRow[]): Map<string, PlanSales> {
  const map = new Map<string, PlanSales>();
  for (const r of rows) {
    if (!r.plan_id) continue;
    const entry = map.get(r.plan_id) ?? {
      planId: r.plan_id,
      sales: 0,
      grossCents: 0,
      freeClaims: 0,
    };
    if (isSale(r)) {
      entry.sales += 1;
      entry.grossCents += r.amount_cents ?? 0;
    } else if (isFreeClaim(r)) {
      entry.freeClaims += 1;
    }
    map.set(r.plan_id, entry);
  }
  return map;
}

export function sinceIso(days: number | null, now = Date.now()): string | null {
  return days ? new Date(now - days * 86_400_000).toISOString() : null;
}

/** Purchases in the window: by paid date when there is one, else created. */
export function inWindow(rows: PurchaseRow[], since: string | null): PurchaseRow[] {
  if (!since) return rows;
  return rows.filter((r) => (r.paid_at ?? r.created_at) >= since);
}

const fullName = (
  p: { first_name?: string | null; last_name?: string | null } | null | undefined,
) => [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();

type ConnectFlags = {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
  stripe_connect_details_submitted?: boolean | null;
};

export type PayoutState = "not_connected" | "pending" | "restricted" | "active";

export function payoutState(c: ConnectFlags): PayoutState {
  if (!c.stripe_connect_account_id) return "not_connected";
  if (c.stripe_connect_charges_enabled && c.stripe_connect_payouts_enabled) return "active";
  return c.stripe_connect_details_submitted ? "restricted" : "pending";
}

// ---------- data access ----------

async function allPurchases(admin: Admin, filter?: (q: any) => any): Promise<PurchaseRow[]> {
  let query = admin
    .from("plan_purchases")
    .select(PURCHASE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (filter) query = filter(query);
  const { data, error } = await query;
  if (error) dbError(error);
  return (data ?? []) as PurchaseRow[];
}

async function testCoachIds(admin: Admin): Promise<Set<string>> {
  const { data, error } = await admin.from("coach_profiles").select("id").eq("is_test", true);
  if (error) dbError(error);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

const SELLER_COLUMNS =
  "id, user_id, first_name, last_name, is_test, photo_url, subscription_tier, entitlement, subscription_status, organization_id, rating_avg, rating_count, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, created_at";

const LISTING_COLUMNS =
  "id, title, status, price, product_type, sport, selected_level, selected_level_to, description, weeks, sessions_per_week, lesson_count, media, media_video, rating_avg, rating_count, view_count, coach_id, organization_id, is_org_template, created_at, updated_at";

/** A plan is a marketplace listing when the coach gave it a product type or a price. */
const isListingShaped = (p: { product_type: string | null; price: number | string | null }) =>
  p.product_type != null || Number(p.price ?? 0) > 0;

/** What buyers see today: active, a Coach Pro seller, not a club's. */
function isLiveListing(
  plan: { status: string; organization_id: string | null; is_org_template?: boolean | null },
  coach: { subscription_tier: string | null; organization_id: string | null } | undefined,
): boolean {
  return (
    plan.status === "active" &&
    !plan.organization_id &&
    !plan.is_org_template &&
    !!coach &&
    coach.subscription_tier === "coach_pro" &&
    !coach.organization_id
  );
}

// ---------- overview ----------

export type MarketplaceOverview = {
  windowDays: number | null;
  sales: SalesSummary;
  allTimeSales: SalesSummary;
  held: HeldSummary;
  activeSellers: number;
  sellersWithSales: number;
  liveListings: number;
  openFlags: number;
  promo: PromoUse[];
  topPlans: {
    planId: string;
    title: string;
    coachName: string;
    sales: number;
    grossCents: number;
    freeClaims: number;
    views: number;
    ratingAvg: number | null;
    ratingCount: number;
  }[];
};

export async function marketplaceOverview(
  admin: Admin,
  opts: { days: number | null; includeTest: boolean },
): Promise<MarketplaceOverview> {
  const [purchasesAll, testCoaches, plansRes, coachesRes, flagsRes] = await Promise.all([
    allPurchases(admin),
    opts.includeTest ? Promise.resolve(new Set<string>()) : testCoachIds(admin),
    admin
      .from("plans")
      .select(LISTING_COLUMNS)
      .eq("status", "active")
      .is("organization_id", null)
      .limit(5000),
    admin
      .from("coach_profiles")
      .select("id, first_name, last_name, subscription_tier, organization_id"),
    admin.from("plan_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  for (const r of [plansRes, coachesRes, flagsRes]) if (r.error) dbError(r.error);

  const purchases = purchasesAll.filter((p) => !p.coach_id || !testCoaches.has(p.coach_id));
  const windowed = inWindow(purchases, sinceIso(opts.days));
  const coaches = new Map<string, any>((coachesRes.data ?? []).map((c: any) => [c.id, c]));
  const plans = ((plansRes.data ?? []) as any[]).filter(
    (p) => isListingShaped(p) && !testCoaches.has(p.coach_id),
  );
  const live = plans.filter((p) => isLiveListing(p, coaches.get(p.coach_id)));
  const activeSellers = new Set(live.map((p) => p.coach_id)).size;
  const sellersWithSales = new Set(windowed.filter(isSale).map((p) => p.coach_id)).size;

  // Top plans: by sales in the window, then revenue, then views. Plans with no sales
  // still rank by views so a new marketplace isn't an empty table.
  const byPlan = salesByPlan(windowed);
  const planIds = new Set<string>([...byPlan.keys(), ...live.map((p) => p.id)]);
  const titlesNeeded = [...planIds].filter((id) => !plans.some((p) => p.id === id));
  let extra: any[] = [];
  if (titlesNeeded.length) {
    const { data, error } = await admin
      .from("plans")
      .select("id, title, coach_id, view_count, rating_avg, rating_count")
      .in("id", titlesNeeded.slice(0, 500));
    if (error) dbError(error);
    extra = data ?? [];
  }
  const planInfo = new Map<string, any>([...plans, ...extra].map((p) => [p.id, p]));
  const topPlans = [...planIds]
    .map((id) => {
      const info = planInfo.get(id);
      const s = byPlan.get(id) ?? { sales: 0, grossCents: 0, freeClaims: 0 };
      return {
        planId: id,
        title: info?.title ?? "Deleted plan",
        coachName: fullName(coaches.get(info?.coach_id)) || "Unknown coach",
        sales: s.sales,
        grossCents: s.grossCents,
        freeClaims: s.freeClaims,
        views: Number(info?.view_count ?? 0),
        ratingAvg: info?.rating_avg != null ? Number(info.rating_avg) : null,
        ratingCount: Number(info?.rating_count ?? 0),
      };
    })
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        b.grossCents - a.grossCents ||
        b.freeClaims - a.freeClaims ||
        b.views - a.views,
    )
    .slice(0, 10);

  return {
    windowDays: opts.days,
    sales: summarizeSales(windowed),
    allTimeSales: summarizeSales(purchases),
    held: summarizeHeld(purchases),
    activeSellers,
    sellersWithSales,
    liveListings: live.length,
    openFlags: flagsRes.count ?? 0,
    promo: promoUsage(windowed),
    topPlans,
  };
}

// ---------- listings ----------

export type ListingSummary = {
  id: string;
  title: string;
  status: string;
  live: boolean;
  price: number;
  productType: string | null;
  sport: string | null;
  level: string | null;
  coachId: string;
  coachName: string;
  coachTier: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  sales: number;
  grossCents: number;
  views: number;
  ratingAvg: number | null;
  ratingCount: number;
  openFlags: number;
  createdAt: string;
  updatedAt: string;
};

export async function marketplaceListings(
  admin: Admin,
  opts: { view: "all" | "live" | "recent"; q: string; includeTest: boolean },
): Promise<ListingSummary[]> {
  let query = admin
    .from("plans")
    .select(LISTING_COLUMNS)
    .is("organization_id", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (opts.view !== "all") query = query.eq("status", "active");
  if (opts.view === "recent") query = query.gte("updated_at", sinceIso(14));
  if (opts.q.trim()) query = query.ilike("title", `%${opts.q.trim().replace(/[%_,()]/g, " ")}%`);
  const [plansRes, coachesRes, testCoaches] = await Promise.all([
    query,
    admin.from("coach_profiles").select(SELLER_COLUMNS),
    opts.includeTest ? Promise.resolve(new Set<string>()) : testCoachIds(admin),
  ]);
  for (const r of [plansRes, coachesRes]) if (r.error) dbError(r.error);
  const planRows = plansRes.data as any[] | null;
  const coaches = new Map<string, any>((coachesRes.data ?? []).map((c: any) => [c.id, c]));
  const rows = (planRows ?? []).filter(
    (p) => !p.is_org_template && isListingShaped(p) && !testCoaches.has(p.coach_id),
  );
  const filtered =
    opts.view === "live" || opts.view === "recent"
      ? rows.filter((p) => isLiveListing(p, coaches.get(p.coach_id)))
      : rows;

  const ids = filtered.map((p) => p.id);
  const [purchases, flags, covers] = await Promise.all([
    ids.length ? allPurchases(admin, (q) => q.in("plan_id", ids)) : Promise.resolve([]),
    ids.length
      ? admin.from("plan_reports").select("plan_id").eq("status", "open").in("plan_id", ids)
      : Promise.resolve({ data: [], error: null }),
    listingCoverUrls(
      admin,
      filtered.map((p) => p.media ?? null),
    ),
  ]);
  if ((flags as any).error) dbError((flags as any).error);
  const flagCount = new Map<string, number>();
  for (const f of ((flags as any).data ?? []) as { plan_id: string }[]) {
    flagCount.set(f.plan_id, (flagCount.get(f.plan_id) ?? 0) + 1);
  }
  const byPlan = salesByPlan(purchases);

  return filtered.map((p, i) => {
    const coach = coaches.get(p.coach_id);
    const s = byPlan.get(p.id);
    return {
      id: p.id,
      title: p.title || "Untitled plan",
      status: p.status,
      live: isLiveListing(p, coach),
      price: Number(p.price ?? 0),
      productType: p.product_type,
      sport: p.sport,
      level: p.selected_level,
      coachId: p.coach_id,
      coachName: fullName(coach) || "Unknown coach",
      coachTier: coach?.subscription_tier ?? null,
      coverUrl: covers[i] ?? null,
      hasVideo: !!p.media_video,
      sales: s?.sales ?? 0,
      grossCents: s?.grossCents ?? 0,
      views: Number(p.view_count ?? 0),
      ratingAvg: p.rating_avg != null ? Number(p.rating_avg) : null,
      ratingCount: Number(p.rating_count ?? 0),
      openFlags: flagCount.get(p.id) ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });
}

export type ListingDetail = ListingSummary & {
  description: string | null;
  levelTo: string | null;
  weeks: number | null;
  sessionsPerWeek: number | null;
  lessonCount: number | null;
  imageUrl: string | null;
  videoUrl: string | null;
  coachUserId: string | null;
  coachEmail: string | null;
  payoutState: PayoutState;
  moves: { id: string; position: number; name: string; description: string | null }[];
  reports: {
    id: string;
    reason: string;
    note: string;
    status: string;
    createdAt: string;
  }[];
  ratings: {
    id: string;
    rating: number;
    review: string | null;
    coachResponse: string | null;
    createdAt: string;
  }[];
  purchases: PurchaseLookupRow[];
};

async function signOne(admin: Admin, url: string | null): Promise<string | null> {
  if (!url) return null;
  const [signed] = await listingCoverUrls(admin, [url]);
  return signed ?? null;
}

async function emailOf(admin: Admin, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) return null;
  return data?.user?.email ?? null;
}

export async function marketplaceListing(admin: Admin, planId: string): Promise<ListingDetail> {
  const { data: plan, error } = await admin
    .from("plans")
    .select(LISTING_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  if (!plan) throw new Error("Plan not found");

  const [coachRes, movesRes, reportsRes, ratingsRes, purchases] = await Promise.all([
    admin.from("coach_profiles").select(SELLER_COLUMNS).eq("id", plan.coach_id).maybeSingle(),
    admin
      .from("plan_moves")
      .select("id, position, name, description")
      .eq("plan_id", planId)
      .order("position", { ascending: true }),
    admin
      .from("plan_reports")
      .select("id, reason, note, status, created_at")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false }),
    admin
      .from("plan_ratings")
      .select("id, rating, review, coach_response, created_at")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false })
      .limit(100),
    allPurchases(admin, (q) => q.eq("plan_id", planId)),
  ]);
  for (const r of [coachRes, movesRes, reportsRes, ratingsRes]) if (r.error) dbError(r.error);
  const coach = coachRes.data;
  const image = plan.media && !isDefaultPlanMedia(plan.media) ? plan.media : null;
  const [imageUrl, videoUrl, defaultCover, coachEmail, purchaseRows] = await Promise.all([
    signOne(admin, image),
    signOne(admin, plan.media_video),
    image ? Promise.resolve(null) : signOne(admin, plan.media),
    emailOf(admin, coach?.user_id ?? null),
    describePurchases(admin, purchases),
  ]);
  const s = salesByPlan(purchases).get(planId);
  const openFlags = (reportsRes.data ?? []).filter((r: any) => r.status === "open").length;

  return {
    id: plan.id,
    title: plan.title || "Untitled plan",
    status: plan.status,
    live: isLiveListing(plan, coach ?? undefined),
    price: Number(plan.price ?? 0),
    productType: plan.product_type,
    sport: plan.sport,
    level: plan.selected_level,
    levelTo: plan.selected_level_to,
    coachId: plan.coach_id,
    coachName: fullName(coach) || "Unknown coach",
    coachTier: coach?.subscription_tier ?? null,
    coachUserId: coach?.user_id ?? null,
    coachEmail,
    payoutState: coach ? payoutState(coach) : "not_connected",
    coverUrl: imageUrl ?? defaultCover,
    hasVideo: !!plan.media_video,
    imageUrl: imageUrl ?? defaultCover,
    videoUrl,
    description: plan.description,
    weeks: plan.weeks,
    sessionsPerWeek: plan.sessions_per_week,
    lessonCount: plan.lesson_count,
    sales: s?.sales ?? 0,
    grossCents: s?.grossCents ?? 0,
    views: Number(plan.view_count ?? 0),
    ratingAvg: plan.rating_avg != null ? Number(plan.rating_avg) : null,
    ratingCount: Number(plan.rating_count ?? 0),
    openFlags,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
    moves: (movesRes.data ?? []).map((m: any) => ({
      id: m.id,
      position: m.position,
      name: m.name,
      description: m.description,
    })),
    reports: (reportsRes.data ?? []).map((r: any) => ({
      id: r.id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.created_at,
    })),
    ratings: (ratingsRes.data ?? []).map((r: any) => ({
      id: r.id,
      rating: r.rating,
      review: r.review,
      coachResponse: r.coach_response,
      createdAt: r.created_at,
    })),
    purchases: purchaseRows,
  };
}

// ---------- sellers ----------

export type SellerSummary = {
  coachId: string;
  userId: string | null;
  name: string;
  email: string | null;
  isTest: boolean;
  tier: string | null;
  entitlement: string | null;
  subscriptionStatus: string | null;
  inClub: boolean;
  payoutState: PayoutState;
  liveListings: number;
  draftListings: number;
  sales: number;
  grossCents: number;
  coachPayoutCents: number;
  heldCents: number;
  ratingAvg: number | null;
  ratingCount: number;
  openFlags: number;
};

async function emailMap(admin: Admin): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) if (u.id && u.email) map.set(u.id, u.email);
  return map;
}

export async function marketplaceSellers(
  admin: Admin,
  opts: { q: string; includeTest: boolean },
): Promise<SellerSummary[]> {
  const [coachesRes, plansRes, purchases, flagsRes, emails] = await Promise.all([
    admin.from("coach_profiles").select(SELLER_COLUMNS),
    admin
      .from("plans")
      .select("id, coach_id, status, price, product_type, organization_id, is_org_template")
      .is("organization_id", null)
      .limit(10_000),
    allPurchases(admin),
    admin.from("plan_reports").select("coach_id").eq("status", "open"),
    emailMap(admin),
  ]);
  for (const r of [coachesRes, plansRes, flagsRes]) if (r.error) dbError(r.error);

  const listings = ((plansRes.data ?? []) as any[]).filter(
    (p) => !p.is_org_template && isListingShaped(p),
  );
  const byCoach = new Map<string, { live: number; draft: number }>();
  const coaches = new Map<string, any>((coachesRes.data ?? []).map((c: any) => [c.id, c]));
  for (const p of listings) {
    const e = byCoach.get(p.coach_id) ?? { live: 0, draft: 0 };
    if (isLiveListing(p, coaches.get(p.coach_id))) e.live += 1;
    else e.draft += 1;
    byCoach.set(p.coach_id, e);
  }
  const purchasesByCoach = new Map<string, PurchaseRow[]>();
  for (const p of purchases) {
    if (!p.coach_id) continue;
    const list = purchasesByCoach.get(p.coach_id) ?? [];
    list.push(p);
    purchasesByCoach.set(p.coach_id, list);
  }
  const flagsByCoach = new Map<string, number>();
  for (const f of (flagsRes.data ?? []) as { coach_id: string | null }[]) {
    if (f.coach_id) flagsByCoach.set(f.coach_id, (flagsByCoach.get(f.coach_id) ?? 0) + 1);
  }

  const q = opts.q.trim().toLowerCase();
  const sellerIds = new Set<string>([...byCoach.keys(), ...purchasesByCoach.keys()]);
  return [...sellerIds]
    .map((id) => coaches.get(id))
    .filter((c): c is any => !!c && (opts.includeTest || !c.is_test))
    .map((c) => {
      const own = purchasesByCoach.get(c.id) ?? [];
      const sales = summarizeSales(own);
      const counts = byCoach.get(c.id) ?? { live: 0, draft: 0 };
      return {
        coachId: c.id,
        userId: c.user_id,
        name: fullName(c) || "Unnamed coach",
        email: c.user_id ? (emails.get(c.user_id) ?? null) : null,
        isTest: !!c.is_test,
        tier: c.subscription_tier,
        entitlement: c.entitlement,
        subscriptionStatus: c.subscription_status,
        inClub: !!c.organization_id,
        payoutState: payoutState(c),
        liveListings: counts.live,
        draftListings: counts.draft,
        sales: sales.sales,
        grossCents: sales.grossCents,
        coachPayoutCents: sales.coachPayoutCents,
        heldCents: summarizeHeld(own).cents,
        ratingAvg: c.rating_avg != null ? Number(c.rating_avg) : null,
        ratingCount: Number(c.rating_count ?? 0),
        openFlags: flagsByCoach.get(c.id) ?? 0,
      };
    })
    .filter(
      (s) => !q || s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        b.grossCents - a.grossCents ||
        b.liveListings - a.liveListings ||
        a.name.localeCompare(b.name),
    );
}

export type SellerDetail = SellerSummary & {
  photoUrl: string | null;
  createdAt: string;
  held: HeldSummary;
  listings: ListingSummary[];
  purchases: PurchaseLookupRow[];
};

export async function marketplaceSeller(admin: Admin, coachId: string): Promise<SellerDetail> {
  const { data: coach, error } = await admin
    .from("coach_profiles")
    .select(SELLER_COLUMNS)
    .eq("id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!coach) throw new Error("Coach not found");

  const [plansRes, purchases, flagsRes, email] = await Promise.all([
    admin
      .from("plans")
      .select(LISTING_COLUMNS)
      .eq("coach_id", coachId)
      .is("organization_id", null)
      .order("updated_at", { ascending: false }),
    allPurchases(admin, (q) => q.eq("coach_id", coachId)),
    admin.from("plan_reports").select("plan_id").eq("coach_id", coachId).eq("status", "open"),
    emailOf(admin, coach.user_id),
  ]);
  for (const r of [plansRes, flagsRes]) if (r.error) dbError(r.error);
  const plans = ((plansRes.data ?? []) as any[]).filter(
    (p) => !p.is_org_template && isListingShaped(p),
  );
  const covers = await listingCoverUrls(
    admin,
    plans.map((p) => p.media ?? null),
  );
  const flagCount = new Map<string, number>();
  for (const f of (flagsRes.data ?? []) as { plan_id: string | null }[]) {
    if (f.plan_id) flagCount.set(f.plan_id, (flagCount.get(f.plan_id) ?? 0) + 1);
  }
  const byPlan = salesByPlan(purchases);
  const listings: ListingSummary[] = plans.map((p, i) => ({
    id: p.id,
    title: p.title || "Untitled plan",
    status: p.status,
    live: isLiveListing(p, coach),
    price: Number(p.price ?? 0),
    productType: p.product_type,
    sport: p.sport,
    level: p.selected_level,
    coachId: p.coach_id,
    coachName: fullName(coach) || "Unnamed coach",
    coachTier: coach.subscription_tier,
    coverUrl: covers[i] ?? null,
    hasVideo: !!p.media_video,
    sales: byPlan.get(p.id)?.sales ?? 0,
    grossCents: byPlan.get(p.id)?.grossCents ?? 0,
    views: Number(p.view_count ?? 0),
    ratingAvg: p.rating_avg != null ? Number(p.rating_avg) : null,
    ratingCount: Number(p.rating_count ?? 0),
    openFlags: flagCount.get(p.id) ?? 0,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
  const sales = summarizeSales(purchases);
  const held = summarizeHeld(purchases);
  const [photoUrl, purchaseRows] = await Promise.all([
    signedCoachPhotoUrl(admin, coach.id, coach.photo_url),
    describePurchases(admin, purchases.slice(0, 200)),
  ]);

  return {
    coachId: coach.id,
    userId: coach.user_id,
    name: fullName(coach) || "Unnamed coach",
    email,
    isTest: !!coach.is_test,
    tier: coach.subscription_tier,
    entitlement: coach.entitlement,
    subscriptionStatus: coach.subscription_status,
    inClub: !!coach.organization_id,
    payoutState: payoutState(coach),
    liveListings: listings.filter((l) => l.live).length,
    draftListings: listings.filter((l) => !l.live).length,
    sales: sales.sales,
    grossCents: sales.grossCents,
    coachPayoutCents: sales.coachPayoutCents,
    heldCents: held.cents,
    held,
    ratingAvg: coach.rating_avg != null ? Number(coach.rating_avg) : null,
    ratingCount: Number(coach.rating_count ?? 0),
    openFlags: [...flagCount.values()].reduce((a, b) => a + b, 0),
    photoUrl,
    createdAt: coach.created_at,
    listings,
    purchases: purchaseRows,
  };
}

// ---------- purchases ----------

export type PurchaseLookupRow = {
  id: string;
  createdAt: string;
  paidAt: string | null;
  buyer: { userId: string | null; name: string; email: string | null; role: string };
  athleteName: string | null;
  planId: string | null;
  planTitle: string;
  copiedPlanId: string | null;
  coachId: string | null;
  coachName: string;
  amountCents: number;
  originalAmountCents: number | null;
  currency: string;
  promoCode: string | null;
  status: string;
  paymentStatus: PaymentStatus;
  paymentDueAt: string | null;
  platformFeeCents: number | null;
  stripeFeeCents: number | null;
  coachPayoutCents: number | null;
  held: HeldKind | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeTransferId: string | null;
};

/** Names and emails for a page of purchases. */
async function describePurchases(admin: Admin, rows: PurchaseRow[]): Promise<PurchaseLookupRow[]> {
  if (!rows.length) return [];
  const buyerIds = [...new Set(rows.map((r) => r.buyer_user_id).filter(Boolean))] as string[];
  const athleteIds = [...new Set(rows.map((r) => r.athlete_id).filter(Boolean))] as string[];
  const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))] as string[];
  const coachIds = [...new Set(rows.map((r) => r.coach_id).filter(Boolean))] as string[];
  const none = Promise.resolve({ data: [], error: null });
  const [parents, athletesByUser, coachesByUser, athletes, plans, coaches, emails] =
    await Promise.all([
      buyerIds.length
        ? admin
            .from("parent_profiles")
            .select("user_id, first_name, last_name")
            .in("user_id", buyerIds)
        : none,
      buyerIds.length
        ? admin.from("athletes").select("user_id, first_name, last_name").in("user_id", buyerIds)
        : none,
      buyerIds.length
        ? admin
            .from("coach_profiles")
            .select("user_id, first_name, last_name")
            .in("user_id", buyerIds)
        : none,
      athleteIds.length
        ? admin.from("athletes").select("id, first_name, last_name").in("id", athleteIds)
        : none,
      planIds.length ? admin.from("plans").select("id, title").in("id", planIds) : none,
      coachIds.length
        ? admin.from("coach_profiles").select("id, first_name, last_name").in("id", coachIds)
        : none,
      emailMap(admin),
    ]);
  for (const r of [parents, athletesByUser, coachesByUser, athletes, plans, coaches] as any[]) {
    if (r.error) dbError(r.error);
  }
  const buyers = new Map<string, { name: string; role: string }>();
  for (const [res, role] of [
    [coachesByUser, "coach"],
    [athletesByUser, "athlete"],
    [parents, "parent"],
  ] as const) {
    for (const p of (res as any).data ?? []) buyers.set(p.user_id, { name: fullName(p), role });
  }
  const athleteNames = new Map<string, string>(
    ((athletes as any).data ?? []).map((a: any) => [a.id, fullName(a)]),
  );
  const planTitles = new Map<string, string>(
    ((plans as any).data ?? []).map((p: any) => [p.id, p.title]),
  );
  const coachNames = new Map<string, string>(
    ((coaches as any).data ?? []).map((c: any) => [c.id, fullName(c)]),
  );

  return rows.map((r) => {
    const buyer = r.buyer_user_id ? buyers.get(r.buyer_user_id) : undefined;
    const email = r.buyer_user_id ? (emails.get(r.buyer_user_id) ?? null) : null;
    return {
      id: r.id,
      createdAt: r.created_at,
      paidAt: r.paid_at,
      buyer: {
        userId: r.buyer_user_id,
        name: buyer?.name || email || "Unknown buyer",
        email,
        role: buyer?.role ?? "unknown",
      },
      athleteName: r.athlete_id ? (athleteNames.get(r.athlete_id) ?? null) : null,
      planId: r.plan_id,
      planTitle: (r.plan_id && planTitles.get(r.plan_id)) || "Deleted plan",
      copiedPlanId: r.copied_plan_id,
      coachId: r.coach_id,
      coachName: (r.coach_id && coachNames.get(r.coach_id)) || "Unknown coach",
      amountCents: r.amount_cents ?? 0,
      originalAmountCents: r.original_amount_cents,
      currency: (r.currency ?? "usd").toUpperCase(),
      promoCode: r.promo_code,
      status: r.status,
      paymentStatus: paymentStatusOf(r),
      paymentDueAt: r.payment_due_at,
      platformFeeCents: r.platform_fee_cents,
      stripeFeeCents: r.stripe_fee_cents,
      coachPayoutCents: r.coach_payout_cents,
      held: heldKind(r),
      stripeCheckoutSessionId: r.stripe_checkout_session_id,
      stripePaymentIntentId: r.stripe_payment_intent_id,
      stripeTransferId: r.stripe_transfer_id,
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Support lookup: purchases by the buyer's email or name, or by a purchase /
 * Stripe id. An empty query lists the latest purchases.
 */
export async function lookupPurchases(admin: Admin, q: string): Promise<PurchaseLookupRow[]> {
  const term = q.trim();
  if (!term) return describePurchases(admin, (await allPurchases(admin)).slice(0, 50));

  if (UUID.test(term)) {
    const rows = await allPurchases(admin, (query) =>
      query.or(`id.eq.${term},buyer_user_id.eq.${term},plan_id.eq.${term},athlete_id.eq.${term}`),
    );
    return describePurchases(admin, rows.slice(0, 200));
  }
  if (/^(cs_|pi_|tr_)/.test(term)) {
    const rows = await allPurchases(admin, (query) =>
      query.or(
        `stripe_checkout_session_id.eq.${term},stripe_payment_intent_id.eq.${term},stripe_transfer_id.eq.${term}`,
      ),
    );
    return describePurchases(admin, rows);
  }

  const needle = term.toLowerCase();
  const pattern = `%${term.replace(/[%_,()]/g, " ")}%`;
  const [emails, parents, athletes, coaches] = await Promise.all([
    emailMap(admin),
    admin
      .from("parent_profiles")
      .select("user_id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`),
    admin
      .from("athletes")
      .select("user_id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`),
    admin
      .from("coach_profiles")
      .select("user_id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`),
  ]);
  for (const r of [parents, athletes, coaches]) if (r.error) dbError(r.error);
  const ids = new Set<string>();
  for (const [id, email] of emails) if (email.toLowerCase().includes(needle)) ids.add(id);
  for (const r of [parents, athletes, coaches]) {
    for (const p of r.data ?? []) if (p.user_id) ids.add(p.user_id);
  }
  // A full name ("Jane Doe") matches neither column alone: match both words.
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const { data, error } = await admin
      .from("parent_profiles")
      .select("user_id, first_name, last_name");
    if (error) dbError(error);
    for (const p of data ?? []) {
      const name = fullName(p).toLowerCase();
      if (p.user_id && words.every((w) => name.includes(w))) ids.add(p.user_id);
    }
  }
  if (!ids.size) return [];
  const rows = await allPurchases(admin, (query) =>
    query.in("buyer_user_id", [...ids].slice(0, 300)),
  );
  return describePurchases(admin, rows.slice(0, 200));
}

// ---------- flags ----------

/** The coach's email, for "Contact coach" on a plan report. */
export async function coachContact(
  admin: Admin,
  coachId: string,
): Promise<{ name: string; email: string | null; userId: string | null }> {
  const { data, error } = await admin
    .from("coach_profiles")
    .select("user_id, first_name, last_name")
    .eq("id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Coach not found");
  return {
    name: fullName(data) || "Coach",
    email: await emailOf(admin, data.user_id),
    userId: data.user_id,
  };
}

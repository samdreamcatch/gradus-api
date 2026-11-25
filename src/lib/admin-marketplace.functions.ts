/**
 * Admin › Marketplace server functions: reports, listings, sellers, purchase
 * lookup, and the coach contact for plan reports. Thin admin-checked wrappers
 * over src/lib/admin-marketplace.server.ts (read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const adminMarketplaceOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        days: z.number().int().positive().max(3650).nullable().default(30),
        includeTest: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { marketplaceOverview } = await import("./admin-marketplace.server");
    return marketplaceOverview(await adminClient(), data);
  });

export const adminMarketplaceListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        view: z.enum(["all", "live", "recent"]).default("live"),
        q: z.string().max(200).default(""),
        includeTest: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { marketplaceListings } = await import("./admin-marketplace.server");
    return marketplaceListings(await adminClient(), data);
  });

export const adminMarketplaceListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { marketplaceListing } = await import("./admin-marketplace.server");
    return marketplaceListing(await adminClient(), data.planId);
  });

export const adminMarketplaceSellers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ q: z.string().max(200).default(""), includeTest: z.boolean().default(false) })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { marketplaceSellers } = await import("./admin-marketplace.server");
    return marketplaceSellers(await adminClient(), data);
  });

export const adminMarketplaceSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { marketplaceSeller } = await import("./admin-marketplace.server");
    return marketplaceSeller(await adminClient(), data.coachId);
  });

export const adminLookupPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().max(200).default("") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { lookupPurchases } = await import("./admin-marketplace.server");
    return lookupPurchases(await adminClient(), data.q);
  });

export const adminCoachContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { coachContact } = await import("./admin-marketplace.server");
    return coachContact(await adminClient(), data.coachId);
  });

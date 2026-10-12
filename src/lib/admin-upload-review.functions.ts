/**
 * Admin → Uploads to review (Mariah, 2026-10-11; migration
 * 20261011150000). Coach PDFs with pictures, or that the server couldn't
 * read with confidence, and coach images stored before links-only, wait
 * here, hidden from athletes and parents, until a person releases or rejects
 * them. Internal admins only (`has_role(admin)`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  rejectUpload,
  releaseUpload,
  reviewReasonLabel,
  sweepCoachUploads,
  type ReviewState,
  type UploadSweepResult,
} from "./coach-upload-review.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

export type UploadReviewRowDTO = {
  id: string;
  title: string;
  kind: "pdf" | "image" | "link";
  state: Exclude<ReviewState, "released">;
  reason: string;
  coachName: string;
  sports: string[];
  createdAt: string;
};

/** Every coach upload not yet released, oldest first. */
export const adminListUploadsForReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: UploadReviewRowDTO[] }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const { data, error } = await admin
      .from("resources")
      .select(
        "id, title, kind, review_state, review_reason, created_at, coach_profiles!resources_coach_id_fkey(first_name, last_name), resource_sports(sport)",
      )
      .not("coach_id", "is", null)
      .neq("review_state", "released")
      .order("created_at", { ascending: true });
    if (error) dbError(error);
    const rows = ((data ?? []) as AnyClient[]).map((r) => {
      const cp = r.coach_profiles as { first_name: string; last_name: string } | null;
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        state: r.review_state,
        reason:
          r.review_state === "pending_check"
            ? "Waiting for the automatic check"
            : reviewReasonLabel(r.review_reason),
        coachName: cp ? `${cp.first_name} ${cp.last_name}`.trim() : "Unknown coach",
        sports: (r.resource_sports ?? []).map((s: { sport: string }) => s.sport),
        createdAt: r.created_at,
      } satisfies UploadReviewRowDTO;
    });
    return { rows };
  });

const idInput = z.object({ id: z.string().uuid() });

/** A five-minute link to open the file for review. */
export const adminUploadReviewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ context, data }): Promise<{ url: string }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const { data: row, error } = await admin
      .from("resources")
      .select("storage_path, coach_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) dbError(error);
    if (!row?.storage_path || !row.coach_id) throw new Error("No stored file for this upload");
    const { data: signed, error: sErr } = await admin.storage
      .from("resource-pdfs")
      .createSignedUrl(row.storage_path, 60 * 5);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Could not open the file");
    return { url: signed.signedUrl };
  });

export const adminReleaseUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const reviewerId = await assertAdmin(context);
    await releaseUpload(await adminClient(), data.id, reviewerId);
    return { ok: true };
  });

export const adminRejectUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    await rejectUpload(await adminClient(), data.id);
    return { ok: true };
  });

/** Run the automatic check on uploads still waiting for it (the daily job does this too). */
export const adminCheckWaitingUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UploadSweepResult> => {
    await assertAdmin(context);
    return sweepCoachUploads(await adminClient(), { budgetMs: 20_000 });
  });

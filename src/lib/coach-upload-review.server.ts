/**
 * Review of coach uploads before athletes or parents see them (Mariah,
 * 2026-10-11; migration 20261011150000). Every coach PDF is checked on the
 * server (`resource-file-check.server.ts`): a PDF with no pictures is
 * released at once; one with any embedded picture, or one the check can't
 * read with confidence (secured, too large, damaged), is held and
 * support@gradussports.com is emailed; a file that isn't a PDF is deleted.
 * A person releases or rejects held files in Admin → Uploads to review.
 * Rejecting deletes the file and the resource and emails the coach.
 *
 * Only the service role can change `resources.review_state` (trigger
 * `guard_resource_review_state`); athletes' and parents' RLS reads, and Ask
 * Gradus retrieval, see a coach upload only once it is `released`.
 */
import { buildAppEmailPayload } from "./email-queue-payload";
import { GRADUS_SUPPORT_EMAIL } from "./safe-sport-content";
import { checkPdfForPictures, type PdfCheck } from "./resource-file-check.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const REVIEW_STATES = ["released", "pending_check", "held"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Why a file is held, in words for the review page and the support email. */
export const REVIEW_REASON_LABEL: Record<string, string> = {
  pictures: "Has pictures",
  encrypted: "Secured PDF (can't be read automatically)",
  attachments: "Carries attached files (open the PDF's attachments)",
  too_large: "Too large to check automatically",
  too_many_pages: "Too many pages to check automatically",
  time_budget: "Took too long to check automatically",
  stored_image: "Image uploaded before links-only (Sept 26)",
  missing_file: "File missing from storage",
};

export function reviewReasonLabel(reason: string | null): string {
  if (!reason) return "Needs review";
  return REVIEW_REASON_LABEL[reason] ?? `Couldn't be read automatically (${reason})`;
}

const BUCKET = "resource-pdfs";
const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = "https://gradus.training";

export type UploadCheckOutcome =
  | { outcome: "released" }
  | { outcome: "held"; reason: string }
  | { outcome: "not_pdf" };

/** Map the PDF check onto what happens to the upload. */
export function outcomeOf(check: PdfCheck): UploadCheckOutcome {
  switch (check.verdict) {
    case "clean":
      return { outcome: "released" };
    case "pictures":
      return { outcome: "held", reason: "pictures" };
    case "unreadable":
      return { outcome: "held", reason: check.reason };
    case "not_pdf":
      return { outcome: "not_pdf" };
  }
}

/** Download a stored coach file and check it. A missing file is held, never released. */
export async function checkStoredUpload(
  admin: Admin,
  storagePath: string,
  check: (bytes: Uint8Array) => Promise<PdfCheck> = checkPdfForPictures,
): Promise<UploadCheckOutcome> {
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error || !data) return { outcome: "held", reason: "missing_file" };
  const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
  return outcomeOf(await check(bytes));
}

/** Email support@ that an upload is waiting. Best effort: the hold itself never depends on it. */
export async function notifyUploadHeld(
  admin: Admin,
  opts: { resourceId: string; title: string; coachName: string; reason: string },
): Promise<void> {
  try {
    const subject = `[Gradus review] Coach upload waiting: ${opts.title}`;
    const lines = [
      `A coach upload is hidden from athletes and parents until someone reviews it.`,
      `Title: ${opts.title}`,
      `Coach: ${opts.coachName}`,
      `Why it was held: ${reviewReasonLabel(opts.reason)}`,
      `Release it only if no picture is a photograph of an athlete or of a minor.`,
      `Review: ${SITE_URL}/admin/uploads-review`,
    ];
    const text = lines.join("\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
      .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
      .join("")}</div>`;
    const messageId = `upload-review-${opts.resourceId}`;
    const { error: pendingError } = await admin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "upload-review",
      recipient_email: GRADUS_SUPPORT_EMAIL,
      status: "pending",
    });
    if (pendingError) return;
    const payload = buildAppEmailPayload({
      messageId,
      to: GRADUS_SUPPORT_EMAIL,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      senderDomain: SENDER_DOMAIN,
      subject,
      html,
      text,
      label: "upload-review",
      idempotencyKey: messageId,
    });
    await admin.rpc("enqueue_email", { queue_name: "transactional_emails", payload });
  } catch (err) {
    console.error("[upload-review] support notice failed", err);
  }
}

/** Tell the coach their file was not published. Best effort. */
export async function notifyUploadRejected(
  admin: Admin,
  opts: { resourceId: string; title: string; to: string | null },
): Promise<void> {
  if (!opts.to) return;
  try {
    const lines = [
      `We didn't publish "${opts.title}" to your athletes.`,
      `Gradus never keeps photos or video of athletes, and this file includes a photograph we can't share. We've deleted it.`,
      `You're welcome to upload a version without that photo. To show a picture or video, add it as a link to a public web page.`,
      `Questions? Reply to ${GRADUS_SUPPORT_EMAIL}.`,
    ];
    const text = lines.join("\n\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">${lines
      .map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`)
      .join("")}</div>`;
    const messageId = `upload-rejected-${opts.resourceId}`;
    const { error: pendingError } = await admin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "upload-rejected",
      recipient_email: opts.to,
      status: "pending",
    });
    if (pendingError) return;
    const payload = buildAppEmailPayload({
      messageId,
      to: opts.to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      senderDomain: SENDER_DOMAIN,
      subject: `Your upload "${opts.title}" wasn't published`,
      html,
      text,
      label: "upload-rejected",
      idempotencyKey: messageId,
    });
    await admin.rpc("enqueue_email", { queue_name: "transactional_emails", payload });
  } catch (err) {
    console.error("[upload-review] coach notice failed", err);
  }
}

async function coachNameAndEmail(
  admin: Admin,
  coachId: string,
): Promise<{ name: string; email: string | null }> {
  const { data } = await admin
    .from("coach_profiles")
    .select("first_name, last_name, user_id")
    .eq("id", coachId)
    .maybeSingle();
  const name = data
    ? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "A coach"
    : "A coach";
  let email: string | null = null;
  if (data?.user_id) {
    const { data: user } = await admin.auth.admin.getUserById(data.user_id);
    email = user?.user?.email ?? null;
  }
  return { name, email };
}

/**
 * Apply a check result to a resource row: release, hold (and email support),
 * or, for a file that isn't a PDF, delete the row and the file.
 */
export async function applyUploadOutcome(
  admin: Admin,
  row: { id: string; title: string; coachId: string; storagePath: string },
  result: UploadCheckOutcome,
): Promise<ReviewState | "deleted"> {
  if (result.outcome === "not_pdf") {
    await admin.storage.from(BUCKET).remove([row.storagePath]);
    await admin.from("resources").delete().eq("id", row.id);
    return "deleted";
  }
  const state: ReviewState = result.outcome === "released" ? "released" : "held";
  const { error } = await admin
    .from("resources")
    .update({
      review_state: state,
      review_reason: result.outcome === "held" ? result.reason : null,
    })
    .eq("id", row.id);
  if (error) throw error;
  if (state === "held") {
    const { name } = await coachNameAndEmail(admin, row.coachId);
    await notifyUploadHeld(admin, {
      resourceId: row.id,
      title: row.title,
      coachName: name,
      reason: result.outcome === "held" ? result.reason : "",
    });
  }
  return state;
}

export type UploadSweepResult = {
  checked: number;
  released: number;
  held: number;
  deleted: number;
  orphansRemoved: number;
};

/**
 * Check coach uploads still `pending_check` (files stored before this rule,
 * or a row a coach wrote directly), oldest first, within a time budget; then
 * delete stored coach files that no resource points at after a day.
 */
export async function sweepCoachUploads(
  admin: Admin,
  opts: {
    budgetMs?: number;
    now?: () => number;
    check?: (b: Uint8Array) => Promise<PdfCheck>;
  } = {},
): Promise<UploadSweepResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? 20_000);
  const result: UploadSweepResult = {
    checked: 0,
    released: 0,
    held: 0,
    deleted: 0,
    orphansRemoved: 0,
  };

  const { data: rows, error } = await admin
    .from("resources")
    .select("id, title, coach_id, storage_path")
    .eq("review_state", "pending_check")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  for (const r of (rows ?? []) as Array<{
    id: string;
    title: string;
    coach_id: string | null;
    storage_path: string | null;
  }>) {
    if (now() > deadline) break;
    if (!r.coach_id || !r.storage_path) continue;
    const outcome = await checkStoredUpload(admin, r.storage_path, opts.check);
    const applied = await applyUploadOutcome(
      admin,
      { id: r.id, title: r.title, coachId: r.coach_id, storagePath: r.storage_path },
      outcome,
    );
    result.checked++;
    if (applied === "released") result.released++;
    else if (applied === "held") result.held++;
    else if (applied === "deleted") result.deleted++;
  }

  if (now() <= deadline) {
    const { data: orphans, error: oErr } = await admin.rpc("orphan_coach_upload_paths", {
      p_older_than: "1 day",
      p_limit: 200,
    });
    if (oErr) throw oErr;
    const names = ((orphans ?? []) as Array<{ name: string }>).map((o) => o.name);
    if (names.length) {
      const { error: rErr } = await admin.storage.from(BUCKET).remove(names);
      if (rErr) throw rErr;
      result.orphansRemoved = names.length;
    }
  }
  return result;
}

/** Release a held upload (a person looked at it). */
export async function releaseUpload(
  admin: Admin,
  resourceId: string,
  reviewerId: string,
): Promise<void> {
  const { error } = await admin
    .from("resources")
    .update({
      review_state: "released",
      review_reason: null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq("id", resourceId)
    .neq("review_state", "released");
  if (error) throw error;
}

/** Reject a held upload: delete the file and the resource, and tell the coach. */
export async function rejectUpload(admin: Admin, resourceId: string): Promise<void> {
  const { data: row, error } = await admin
    .from("resources")
    .select("id, title, coach_id, storage_path")
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return;
  if (row.storage_path) {
    const { error: sErr } = await admin.storage.from(BUCKET).remove([row.storage_path]);
    if (sErr) throw sErr;
  }
  const { error: dErr } = await admin.from("resources").delete().eq("id", resourceId);
  if (dErr) throw dErr;
  if (row.coach_id) {
    const { email } = await coachNameAndEmail(admin, row.coach_id);
    await notifyUploadRejected(admin, { resourceId, title: row.title, to: email });
  }
}

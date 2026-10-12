import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SPORTS } from "@/lib/coach-sports";
import {
  adminCheckWaitingUploads,
  adminListUploadsForReview,
  adminRejectUpload,
  adminReleaseUpload,
  adminUploadReviewUrl,
  type UploadReviewRowDTO,
} from "@/lib/admin-upload-review.functions";

export const Route = createFileRoute("/_authenticated/admin/uploads-review")({
  component: UploadsReviewPage,
});

function sportLabel(key: string) {
  return SPORTS.find((s) => s.key === key)?.label ?? key;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function UploadsReviewPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListUploadsForReview);
  const urlFn = useServerFn(adminUploadReviewUrl);
  const releaseFn = useServerFn(adminReleaseUpload);
  const checkFn = useServerFn(adminCheckWaitingUploads);
  const list = useQuery({ queryKey: ["admin-uploads-review"], queryFn: () => listFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-uploads-review"] });
  const [rejecting, setRejecting] = useState<UploadReviewRowDTO | null>(null);

  const open = useMutation({
    mutationFn: (id: string) => urlFn({ data: { id } }),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (e: Error) => toast.error(e.message),
  });
  const release = useMutation({
    mutationFn: (id: string) => releaseFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Released to the coach's athletes and parents");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const check = useMutation({
    mutationFn: () => checkFn(),
    onSuccess: (r) => {
      toast.success(
        `Checked ${r.checked}: ${r.released} released, ${r.held} held, ${r.deleted} not PDFs deleted. Stray files removed: ${r.orphansRemoved}.`,
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data?.rows ?? [];
  const waiting = rows.filter((r) => r.state === "pending_check").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <Eyebrow>Content</Eyebrow>
        <h1 className="font-display text-3xl">Uploads to review</h1>
        <p className="text-text-secondary max-w-prose">
          Coach uploads that athletes and parents can&rsquo;t see yet. A PDF lands here when it has
          any embedded picture, or when the server couldn&rsquo;t read it with confidence (a secured
          PDF, for example). Images coaches stored before links-only are here too. Each new hold
          emails support@gradussports.com.
        </p>
        <p className="max-w-prose font-medium">
          Release a file only if no picture is a photograph of an athlete or of a minor. Rejecting
          deletes the file and emails the coach.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Tag tone="default">Waiting: {rows.length}</Tag>
          {waiting > 0 ? <Tag tone="muted">Not yet checked: {waiting}</Tag> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {check.isPending ? "Checking…" : "Run the automatic check now"}
          </Button>
        </div>
      </header>

      {list.isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-secondary">Nothing waiting for review.</p>
      ) : (
        <ul className="divide-y divide-divider rounded-lg border border-divider">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-text-primary">{r.title}</p>
                <p className="text-sm text-text-secondary">
                  {r.coachName} · {r.sports.map(sportLabel).join(", ") || "No sport"} · uploaded{" "}
                  {formatDate(r.createdAt)} · {r.kind.toUpperCase()}
                </p>
                <Tag tone={r.state === "held" ? "accent" : "muted"}>{r.reason}</Tag>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => open.mutate(r.id)}
                  disabled={open.isPending}
                >
                  Open file
                </Button>
                <Button
                  size="sm"
                  onClick={() => release.mutate(r.id)}
                  disabled={release.isPending || r.state === "pending_check"}
                  title={
                    r.state === "pending_check"
                      ? "Run the automatic check first"
                      : "Show it to the coach's athletes and parents"
                  }
                >
                  Release
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejecting(r)}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RejectDialog
        row={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => {
          setRejecting(null);
          refresh();
        }}
      />
    </div>
  );
}

function RejectDialog({
  row,
  onClose,
  onDone,
}: {
  row: UploadReviewRowDTO | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const rejectFn = useServerFn(adminRejectUpload);
  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Rejected; the file is deleted and the coach was emailed");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog
      open={!!row}
      onOpenChange={(isOpen) => {
        if (!isOpen && !reject.isPending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject &ldquo;{row?.title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the file and the resource for good, and emails {row?.coachName} that it
            wasn&rsquo;t published because it includes a photograph Gradus can&rsquo;t share.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reject.isPending}>Keep it waiting</AlertDialogCancel>
          <AlertDialogAction
            disabled={reject.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (row) reject.mutate(row.id);
            }}
          >
            {reject.isPending ? "Rejecting…" : "Reject and delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

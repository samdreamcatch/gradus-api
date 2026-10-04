import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
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
import {
  adminListPausedAthletes,
  adminRestorePausedAthlete,
  type PausedAthleteDTO,
} from "@/lib/admin-paused-athletes.functions";

export const Route = createFileRoute("/_authenticated/admin/paused-athletes")({
  component: PausedAthletesPage,
});

function fullName(first: string, last: string) {
  return `${first} ${last}`.trim() || "(no name)";
}

function formatDate(iso: string | null) {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Apple withdrew consent again after this pause began (a newer `RESCIND_CONSENT`). */
function withdrawnAgain(row: PausedAthleteDTO) {
  if (!row.latestWithdrawalAt || !row.pausedAt) return false;
  return Date.parse(row.latestWithdrawalAt) > Date.parse(row.pausedAt);
}

function PausedAthletesPage() {
  const listFn = useServerFn(adminListPausedAthletes);
  const list = useQuery({ queryKey: ["admin-paused-athletes"], queryFn: () => listFn() });
  const rows = list.data?.rows ?? [];
  const [restoring, setRestoring] = useState<PausedAthleteDTO | null>(null);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <Eyebrow>Membership</Eyebrow>
        <h1 className="font-display text-3xl">Paused athletes</h1>
        <p className="text-text-secondary max-w-prose">
          Athletes paused because a parent withdrew consent through Apple (App Store{" "}
          <code>RESCIND_CONSENT</code>). Apple never tells us when consent comes back, so restore an
          athlete only when their family asks through support@gradussports.com and you have
          confirmed it is their parent. Related: PRD §12 #29.
        </p>
      </header>

      <section className="space-y-4">
        {list.isLoading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : list.isError ? (
          <p className="text-destructive">{(list.error as Error).message}</p>
        ) : !rows.length ? (
          <p className="text-text-secondary">No paused athletes.</p>
        ) : (
          <ul className="divide-y divide-divider rounded-xl border border-divider bg-card">
            {rows.map((r) => (
              <PausedRow key={r.athleteId} row={r} onRestore={() => setRestoring(r)} />
            ))}
          </ul>
        )}
      </section>

      <RestoreDialog row={restoring} onClose={() => setRestoring(null)} />
    </div>
  );
}

function PausedRow({ row, onRestore }: { row: PausedAthleteDTO; onRestore: () => void }) {
  const name = fullName(row.firstName, row.lastName);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {row.userId ? (
            <Link
              to="/admin/users/$userId"
              params={{ userId: row.userId }}
              className="font-medium text-accent-ink underline-offset-4 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium">{name}</span>
          )}
          <Tag tone="muted">Paused {formatDate(row.pausedAt)}</Tag>
          {withdrawnAgain(row) ? (
            <Tag tone="accent">Withdrawn again {formatDate(row.latestWithdrawalAt)}</Tag>
          ) : null}
        </div>
        <div className="text-xs text-text-secondary">
          {row.parent ? (
            <>
              Parent:{" "}
              {row.parent.userId ? (
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: row.parent.userId }}
                  className="text-accent-ink underline-offset-4 hover:underline"
                >
                  {fullName(row.parent.firstName, row.parent.lastName)}
                </Link>
              ) : (
                fullName(row.parent.firstName, row.parent.lastName)
              )}
              {row.parent.adultVerified ? " · verified adult" : " · not adult-verified"}
            </>
          ) : (
            "No parent has claimed this athlete"
          )}
          {" · "}restores to {row.restoresTo}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRestore}>
        Restore account
      </Button>
    </li>
  );
}

function RestoreDialog({ row, onClose }: { row: PausedAthleteDTO | null; onClose: () => void }) {
  const qc = useQueryClient();
  const restoreFn = useServerFn(adminRestorePausedAthlete);
  const [note, setNote] = useState("");
  const restore = useMutation({
    mutationFn: (input: { athleteId: string; note: string; seenWithdrawalAt: string | null }) =>
      restoreFn({ data: input }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-paused-athletes"] });
      toast.success(
        res.state === "active" ? "Account restored." : "Account restored to provisional.",
      );
      setNote("");
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["admin-paused-athletes"] });
    },
  });

  const name = row ? fullName(row.firstName, row.lastName) : "";
  const tooShort = note.trim().length < 3;

  return (
    <AlertDialog
      open={!!row}
      onOpenChange={(open) => {
        if (!open && !restore.isPending) {
          setNote("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore {name}&rsquo;s account?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>This will:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  exempt this athlete from the stored Apple consent withdrawal, so their next
                  sign-in does not pause them again (the withdrawal still applies to anyone else on
                  that download, and a new withdrawal from Apple pauses them again);
                </li>
                {row?.parent ? (
                  <li>
                    record fresh consent from {fullName(row.parent.firstName, row.parent.lastName)}{" "}
                    (method: admin, with your note);
                  </li>
                ) : null}
                <li>
                  set the account to <strong>{row?.restoresTo}</strong>.
                </li>
              </ul>
              {row && withdrawnAgain(row) ? (
                <p className="font-medium">
                  Apple reported another consent withdrawal on {formatDate(row.latestWithdrawalAt)},
                  after this pause began. Make sure the family&rsquo;s request is newer than that.
                </p>
              ) : null}
              {row?.parent && !row.parent.adultVerified ? (
                <p className="font-medium">
                  This parent hasn&rsquo;t completed adult verification. Confirm who they are before
                  restoring.
                </p>
              ) : null}
              <p>
                A sibling paused by the same withdrawal stays paused until you restore them too.
                Every restore is logged with your note.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Support request</span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who asked, when, and how you confirmed it was the parent"
            rows={3}
            maxLength={500}
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restore.isPending}>Keep paused</AlertDialogCancel>
          <AlertDialogAction
            disabled={tooShort || restore.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (row)
                restore.mutate({
                  athleteId: row.athleteId,
                  note: note.trim(),
                  seenWithdrawalAt: row.latestWithdrawalAt,
                });
            }}
          >
            {restore.isPending ? "Restoring…" : "Restore account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

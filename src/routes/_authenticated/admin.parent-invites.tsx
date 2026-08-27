import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
import { GuardianInviteControls } from "@/components/admin/guardian-invite-controls";
import { listPendingGuardianInvites } from "@/lib/guardian-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/parent-invites")({
  component: ParentInvitesPage,
});

function ParentInvitesPage() {
  const list = useServerFn(listPendingGuardianInvites);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-pending-guardian-invites"],
    queryFn: () => list(),
  });

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);

  const rows = (data ?? [])
    .filter((r) => showTest || !r.isTest)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        r.athleteName.toLowerCase().includes(q) ||
        (r.guardianEmail ?? "").toLowerCase().includes(q) ||
        (r.claimCode ?? "").toLowerCase().includes(q) ||
        r.coachNames.join(" ").toLowerCase().includes(q)
      );
    });

  const copyAll = async () => {
    const text = rows
      .map(
        (r) =>
          `${r.athleteName}\t${r.guardianEmail ?? "—"}\t${r.claimCode ?? "—"}\t${r.claimUrl ?? "—"}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("List copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
            Membership
          </Eyebrow>
          <h1 className="font-display text-h2 text-text-primary">Parent invites</h1>
          <p className="text-sm text-text-secondary">
            Athletes whose parent or guardian hasn&apos;t joined yet. Each has a personal claim link
            and a typeable code that works at gradus.training.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={copyAll} disabled={rows.length === 0}>
          <Copy className="size-4" aria-hidden /> Copy list
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search athlete, email, code, coach"
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          type="button"
          variant={showTest ? "default" : "outline"}
          size="sm"
          onClick={() => setShowTest((v) => !v)}
        >
          {showTest ? "Hiding nothing" : "Show test users"}
        </Button>
        <span className="text-sm text-text-tertiary">{rows.length} pending</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-tertiary">No pending parent invites.</p>
      ) : (
        <ul className="divide-y divide-divider rounded-xl border border-divider bg-card">
          {rows.map((r) => (
            <li key={r.athleteId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg text-text-primary">
                    {r.athleteName}
                    {r.isTest && (
                      <Tag size="caption" className="ml-2">
                        test
                      </Tag>
                    )}
                    {r.selfManaged && (
                      <Tag size="caption" className="ml-2">
                        self-managed
                      </Tag>
                    )}
                  </p>
                  <p className="truncate text-sm text-text-secondary">
                    {r.guardianEmail ?? "No email on file"}
                    {r.coachNames.length > 0 && ` · ${r.coachNames.join(", ")}`}
                  </p>
                  {r.sameInbox && (
                    <p className="text-xs text-text-secondary">
                      Goes to the athlete&apos;s own inbox
                    </p>
                  )}
                  <p className="text-xs text-text-tertiary">
                    {r.invitedAt
                      ? `Invited ${new Date(r.invitedAt).toLocaleDateString()}`
                      : "Never invited"}
                    {r.claimCode ? ` · code ${r.claimCode}` : ""}
                    {` · ${
                      r.lastSend
                        ? `last email ${r.lastSend.status} ${new Date(
                            r.lastSend.at,
                          ).toLocaleDateString()}`
                        : "no email logged"
                    }`}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(open === r.athleteId ? null : r.athleteId)}
                >
                  <ChevronDown className="size-4" aria-hidden />
                  {open === r.athleteId ? "Close" : "Manage"}
                </Button>
              </div>
              {open === r.athleteId && (
                <div className="mt-4 rounded-lg border border-divider bg-elevated p-4">
                  <GuardianInviteControls athleteId={r.athleteId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-tertiary">
        Looking for a specific person?{" "}
        <Link to="/admin/users" className="underline">
          Search all users
        </Link>
        .
      </p>
    </div>
  );
}

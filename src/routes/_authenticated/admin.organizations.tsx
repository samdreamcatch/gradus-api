import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  createOrganization,
  getOrganizationStats,
  listOrganizations,
  rotateOrganizationInviteCode,
  updateOrganization,
} from "@/lib/coach-org.functions";

export const Route = createFileRoute("/_authenticated/admin/organizations")({
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const list = useServerFn(listOrganizations);
  const stats = useServerFn(getOrganizationStats);
  const create = useServerFn(createOrganization);
  const update = useServerFn(updateOrganization);
  const rotate = useServerFn(rotateOrganizationInviteCode);
  const qc = useQueryClient();

  const { data: orgsData } = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: () => list(),
  });
  const { data: statsData } = useQuery({
    queryKey: ["admin-organization-stats"],
    queryFn: () => stats(),
  });

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await create({
        data: { name: name.trim(), notes: notes.trim() || null },
      });
      setName("");
      setNotes("");
      toast.success(`Created — code ${res.code}`);
      await qc.invalidateQueries({ queryKey: ["admin-organizations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    try {
      await update({ data: { id, active: next } });
      await qc.invalidateQueries({ queryKey: ["admin-organizations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const rotateCode = async (id: string) => {
    try {
      const res = await rotate({ data: { organizationId: id } });
      toast.success(`New code: ${res.code}`);
      await qc.invalidateQueries({ queryKey: ["admin-organizations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rotate failed");
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const orgs = orgsData?.organizations ?? [];
  const counts = statsData?.counts ?? {};

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <Link
          to="/admin"
          search={{ test: false }}
          className="text-xs font-semibold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          ← Admin
        </Link>
        <h1 className="font-display text-h1 text-text-primary">Organizations</h1>
        <p className="text-sm text-text-secondary">
          Clubs, academies, and associations whose coaches skip individual
          payment. Each org has a rotatable 8-character invite code.
        </p>
      </header>

      <section className="rounded-2xl border border-divider bg-card p-5">
        <h2 className="mb-4 font-display text-h3 text-text-primary">New organization</h2>
        <form onSubmit={handleCreate} className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Elite Tennis Academy"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-notes">Notes (optional)</Label>
            <Textarea
              id="new-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contract details, seat count, contact person…"
              maxLength={500}
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create organization"}
            </Button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-divider bg-card">
        <h2 className="px-5 pt-4 font-display text-h3 text-text-primary">All organizations</h2>
        {orgs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-secondary">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider text-left text-text-tertiary">
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-5 py-3">Name</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3">Active code</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-right">Coaches</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-5 py-3 text-right">Active</Eyebrow>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-elevated">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-text-primary">{o.name}</div>
                      {o.notes && (
                        <div className="line-clamp-1 text-xs text-text-tertiary">{o.notes}</div>
                      )}
                      <div className="text-[11px] text-text-tertiary">/{o.slug}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-elevated px-2 py-1 font-mono text-xs uppercase tracking-widest text-text-primary">
                          {o.activeCode ?? "—"}
                        </code>
                        {o.activeCode && (
                          <button
                            type="button"
                            onClick={() => void copy(o.activeCode!)}
                            className="rounded p-1 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                            aria-label="Copy code"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void rotateCode(o.id)}
                          className="rounded p-1 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                          aria-label="Rotate code"
                          title="Rotate code"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-text-primary">
                      {counts[o.id] ?? 0}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Switch
                        checked={o.active}
                        onCheckedChange={(v) => void toggleActive(o.id, v === true)}
                        aria-label={`Toggle ${o.name} active`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

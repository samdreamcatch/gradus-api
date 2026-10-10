import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Copy, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  createOrganization,
  getOrganizationStats,
  listOrganizations,
  rotateOrganizationInviteCode,
  setOrganizationInviteCode,
  updateOrganization,
} from "@/lib/coach-org.functions";

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  notes: string | null;
  city: string | null;
  region: string | null;
  logoUrl: string | null;
  isListed: boolean;
  activeCode: string | null;
};

export const Route = createFileRoute("/_authenticated/admin/organizations")({
  component: OrganizationsPage,
});

function OrganizationsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
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
          Clubs, academies, and associations whose coaches skip individual payment. Each org has a
          rotatable invite code.
        </p>
      </header>

      <OrgsTab />
    </div>
  );
}

/* ---------- Organizations tab ---------- */

function OrgsTab() {
  const list = useServerFn(listOrganizations);
  const stats = useServerFn(getOrganizationStats);
  const create = useServerFn(createOrganization);
  const update = useServerFn(updateOrganization);
  const rotate = useServerFn(rotateOrganizationInviteCode);
  const setCode = useServerFn(setOrganizationInviteCode);
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
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [notes, setNotes] = useState("");
  const [code, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgRow | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trimmedCode = code.trim().toUpperCase();
      if (trimmedCode && !/^[A-Z0-9]{4,16}$/.test(trimmedCode)) {
        throw new Error("Code must be 4–16 letters or numbers.");
      }
      const res = await create({
        data: {
          name: name.trim(),
          notes: notes.trim() || null,
          ...(trimmedCode ? { code: trimmedCode } : {}),
        },
      });
      // If city/region were provided, patch them in a follow-up update since
      // create only accepts name/notes/code today.
      if (city.trim() || region.trim()) {
        await update({
          data: {
            id: res.id,
            city: city.trim() || null,
            region: region.trim() || null,
          },
        });
      }
      setName("");
      setCity("");
      setRegion("");
      setNotes("");
      setCodeInput("");
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

  const toggleListed = async (id: string, next: boolean) => {
    try {
      await update({ data: { id, isListed: next } });
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

  const editCode = async (id: string, currentCode: string | null) => {
    const input = window.prompt(
      "Set a custom active code (4–16 letters or numbers). This deactivates the current code.",
      currentCode ?? "",
    );
    if (input === null) return;
    const next = input.trim().toUpperCase();
    if (!next) return;
    if (!/^[A-Z0-9]{4,16}$/.test(next)) {
      toast.error("Code must be 4–16 letters or numbers.");
      return;
    }
    try {
      const res = await setCode({ data: { organizationId: id, code: next } });
      toast.success(`Active code: ${res.code}`);
      await qc.invalidateQueries({ queryKey: ["admin-organizations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set code");
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
    <>
      <section className="rounded-2xl border border-divider bg-card p-5">
        <h2 className="mb-4 font-display text-h3 text-text-primary">New organization</h2>
        <form onSubmit={handleCreate} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-city">City</Label>
                <Input
                  id="new-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ashburn"
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-region">Region</Label>
                <Input
                  id="new-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="VA"
                  maxLength={120}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-code">Active code (optional)</Label>
              <Input
                id="new-code"
                value={code}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="WILSON — 4–16 letters or numbers. Leave blank to auto-generate."
                maxLength={16}
                className="font-mono uppercase tracking-widest"
              />
            </div>
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
                  <Eyebrow
                    as="th"
                    size="caption"
                    tone="tertiary"
                    weight="normal"
                    tracking="wide"
                    className="px-5 py-3"
                  >
                    Name
                  </Eyebrow>
                  <Eyebrow
                    as="th"
                    size="caption"
                    tone="tertiary"
                    weight="normal"
                    tracking="wide"
                    className="px-3 py-3"
                  >
                    Active code
                  </Eyebrow>
                  <Eyebrow
                    as="th"
                    size="caption"
                    tone="tertiary"
                    weight="normal"
                    tracking="wide"
                    className="px-3 py-3 text-right"
                  >
                    Coaches
                  </Eyebrow>
                  <Eyebrow
                    as="th"
                    size="caption"
                    tone="tertiary"
                    weight="normal"
                    tracking="wide"
                    className="px-3 py-3 text-right"
                  >
                    Listed
                  </Eyebrow>
                  <Eyebrow
                    as="th"
                    size="caption"
                    tone="tertiary"
                    weight="normal"
                    tracking="wide"
                    className="px-5 py-3 text-right"
                  >
                    Active
                  </Eyebrow>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-elevated">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => setEditingOrg(o as OrgRow)}
                        className="text-left font-semibold text-text-primary underline-offset-2 hover:underline"
                      >
                        {o.name}
                      </button>
                      {(o.city || o.region) && (
                        <div className="text-xs text-text-secondary">
                          {[o.city, o.region].filter(Boolean).join(", ")}
                        </div>
                      )}
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
                          onClick={() => void editCode(o.id, o.activeCode)}
                          className="rounded p-1 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                          aria-label="Set custom code"
                          title="Set custom code"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void rotateCode(o.id)}
                          className="rounded p-1 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                          aria-label="Rotate code"
                          title="Rotate to a random code"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-text-primary">
                      {counts[o.id] ?? 0}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Switch
                        checked={o.isListed}
                        onCheckedChange={(v) => void toggleListed(o.id, v === true)}
                        aria-label={`Toggle ${o.name} listed in search`}
                      />
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

      <EditOrgSheet
        org={editingOrg}
        onOpenChange={(open) => !open && setEditingOrg(null)}
        onSaved={async () => {
          await qc.invalidateQueries({ queryKey: ["admin-organizations"] });
        }}
      />
    </>
  );
}

/* ---------- Edit organization sheet ---------- */

function EditOrgSheet({
  org,
  onOpenChange,
  onSaved,
}: {
  org: OrgRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const update = useServerFn(updateOrganization);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [isListed, setIsListed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setCity(org.city ?? "");
    setRegion(org.region ?? "");
    setLogoUrl(org.logoUrl ?? "");
    setNotes(org.notes ?? "");
    setActive(org.active);
    setIsListed(org.isListed);
    setError(null);
  }, [org]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    setError(null);
    try {
      await update({
        data: {
          id: org.id,
          name: name.trim(),
          city: city.trim() || null,
          region: region.trim() || null,
          logoUrl: logoUrl.trim() || null,
          notes: notes.trim() || null,
          active,
          isListed,
        },
      });
      toast.success("Saved");
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!org} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit organization</SheetTitle>
          {org && <SheetDescription>/{org.slug}</SheetDescription>}
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-city">City</Label>
              <Input
                id="edit-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-region">Region</Label>
              <Input
                id="edit-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                maxLength={120}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-logo">Logo URL</Label>
            <Input
              id="edit-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={5}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-divider p-3">
            <div>
              <div className="text-sm font-medium text-text-primary">Listed in search</div>
              <div className="text-xs text-text-secondary">
                Coaches can find this org in the join flow.
              </div>
            </div>
            <Switch checked={isListed} onCheckedChange={(v) => setIsListed(v === true)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-divider p-3">
            <div>
              <div className="text-sm font-medium text-text-primary">Active</div>
              <div className="text-xs text-text-secondary">
                Inactive orgs stop accepting new joins.
              </div>
            </div>
            <Switch checked={active} onCheckedChange={(v) => setActive(v === true)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  getPromoCodeStats,
  syncPromoCodeToStripe,
} from "@/lib/promo-codes.functions";
import { getStripeEnvironment } from "@/lib/stripe";

export const Route = createFileRoute("/_authenticated/admin/promo-codes")({
  component: PromoCodesPage,
});

function PromoCodesPage() {
  const list = useServerFn(listPromoCodes);
  const stats = useServerFn(getPromoCodeStats);
  const create = useServerFn(createPromoCode);
  const update = useServerFn(updatePromoCode);
  const sync = useServerFn(syncPromoCodeToStripe);
  const qc = useQueryClient();

  const { data: codesData } = useQuery({
    queryKey: ["admin-promo-codes"],
    queryFn: () => list(),
  });
  const { data: statsData } = useQuery({
    queryKey: ["admin-promo-code-stats"],
    queryFn: () => stats(),
  });

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [percentOff, setPercentOff] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncingCode, setSyncingCode] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create({
        data: {
          code: code.trim().toUpperCase(),
          label: label.trim(),
          notes: notes.trim() || null,
          percentOff,
          active: true,
        },
      });
      setCode("");
      setLabel("");
      setNotes("");
      setPercentOff(0);
      toast.success("Promo code created");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
        qc.invalidateQueries({ queryKey: ["admin-promo-code-stats"] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create code");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: string, next: boolean) => {
    try {
      await update({ data: { code: c, active: next } });
      await qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const updatePercent = async (c: string, next: number) => {
    try {
      await update({ data: { code: c, percentOff: next } });
      await qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleSync = async (c: string) => {
    setSyncingCode(c);
    try {
      const env = getStripeEnvironment();
      const res = await sync({ data: { code: c, environment: env } });
      if ("error" in res && res.error) {
        toast.error(res.error);
      } else if ("alreadyMinted" in res && res.alreadyMinted) {
        toast.info(`Already minted in ${env}`);
      } else {
        toast.success(`Minted in ${env}`);
        await qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingCode(null);
    }
  };

  const codes = codesData?.codes ?? [];
  const tally = statsData?.stats ?? {};

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <Link
          to="/admin"
          search={{ test: false }}
          className="text-xs font-semibold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          ← Admin
        </Link>
        <h1 className="font-display text-h1 text-text-primary">Promo codes</h1>
        <p className="text-sm text-text-secondary">
          Track attribution and apply lifetime percent discounts at Stripe checkout. Codes with a
          non-zero <span className="font-mono">percent_off</span> need to be minted per env — hit Sync sandbox / live per row.
        </p>
      </header>

      <section className="rounded-2xl border border-divider bg-card p-5">
        <h2 className="font-display text-h3 text-text-primary mb-4">New code</h2>
        <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-code">Code</Label>
            <Input
              id="new-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32))}
              placeholder="JANESMITH"
              maxLength={32}
              className="font-mono uppercase tracking-widest"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-label">Label</Label>
            <Input
              id="new-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Jane Smith"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-percent">Percent off (lifetime)</Label>
            <Input
              id="new-percent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percentOff}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPercentOff(Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0);
              }}
            />
            <p className="text-xs text-text-tertiary">
              0 = attribution-only (no discount). Applies forever on every renewal.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="new-notes">Notes (optional)</Label>
            <Textarea
              id="new-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Campaign, platform, contract details…"
              maxLength={500}
              rows={2}
            />
          </div>
          {error && <p className="sm:col-span-2 text-sm text-destructive">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || !code.trim() || !label.trim()}>
              {busy ? "Creating…" : "Create code"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-divider bg-card overflow-hidden">
        <h2 className="font-display text-h3 text-text-primary px-5 pt-4">All codes</h2>
        {codes.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-secondary">No codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider text-left text-text-tertiary">
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-5 py-3">Code</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3">Label</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-right">% off</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3">Stripe</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-right">P</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-right">C</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-right">A</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-5 py-3 text-right">Active</Eyebrow>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {codes.map((row) => {
                  const s = tally[row.code] ?? { parents: 0, coaches: 0, athletes: 0 };
                  const mintedSandbox = Boolean(row.stripe_promo_id_sandbox);
                  const mintedLive = Boolean(row.stripe_promo_id_live);
                  return (
                    <tr key={row.code} className="hover:bg-elevated align-top">
                      <td className="px-5 py-3 font-mono uppercase tracking-widest text-text-primary">
                        {row.code}
                      </td>
                      <td className="px-3 py-3 text-text-primary">
                        <div>{row.label}</div>
                        <div className="text-xs text-text-tertiary">
                          {row.duration === "repeating"
                            ? `${row.duration_in_months ?? "?"} mo repeating`
                            : "forever"}
                        </div>
                        {row.notes && (
                          <div className="text-xs text-text-tertiary line-clamp-1">{row.notes}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={row.percent_off ?? 0}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            const clamped = Number.isFinite(n)
                              ? Math.min(100, Math.max(0, Math.round(n)))
                              : 0;
                            if (clamped !== (row.percent_off ?? 0)) {
                              void updatePercent(row.code, clamped);
                            }
                          }}
                          className="h-8 w-16 text-right font-mono text-xs"
                          aria-label={`Percent off for ${row.code}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                mintedSandbox ? "text-text-primary" : "text-text-tertiary"
                              }
                            >
                              sandbox: {mintedSandbox ? "minted" : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={mintedLive ? "text-text-primary" : "text-text-tertiary"}
                            >
                              live: {mintedLive ? "minted" : "—"}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 px-2 text-[11px]"
                            disabled={
                              syncingCode === row.code || !row.percent_off || row.percent_off <= 0
                            }
                            onClick={() => void handleSync(row.code)}
                          >
                            {syncingCode === row.code ? "Syncing…" : "Sync (current env)"}
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-text-secondary">{s.parents}</td>
                      <td className="px-3 py-3 text-right font-mono text-text-secondary">{s.coaches}</td>
                      <td className="px-3 py-3 text-right font-mono text-text-secondary">{s.athletes}</td>
                      <td className="px-5 py-3 text-right">
                        <Switch
                          checked={row.active}
                          onCheckedChange={(v) => void toggleActive(row.code, v === true)}
                          aria-label={`Toggle ${row.code} active`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

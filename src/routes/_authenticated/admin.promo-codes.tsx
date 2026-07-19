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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tag } from "@/components/ui/tag";
import { Link as RouterLink } from "@tanstack/react-router";
import {
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  getPromoCodeStats,
  syncPromoCodeToStripe,
  listPromoCodeUsers,
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
  const [duration, setDuration] = useState<"forever" | "repeating">("forever");
  const [durationInMonths, setDurationInMonths] = useState<number>(3);
  const [cardRequired, setCardRequired] = useState(true);
  const [appliesToPlans, setAppliesToPlans] = useState<("coach" | "coach_pro")[]>([
    "coach",
    "coach_pro",
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncingCode, setSyncingCode] = useState<string | null>(null);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [detailCode, setDetailCode] = useState<string | null>(null);




  const togglePlanInNew = (plan: "coach" | "coach_pro") => {
    setAppliesToPlans((prev) => {
      if (prev.includes(plan)) {
        const next = prev.filter((p) => p !== plan);
        return next.length ? next : prev; // must keep at least one
      }
      return [...prev, plan];
    });
  };

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
          duration,
          durationInMonths: duration === "repeating" ? durationInMonths : null,
          cardRequired,
          appliesToPlans,
        },
      });
      setCode("");
      setLabel("");
      setNotes("");
      setPercentOff(0);
      setDuration("forever");
      setDurationInMonths(3);
      setCardRequired(true);
      setAppliesToPlans(["coach", "coach_pro"]);
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

  const updateField = async (
    c: string,
    patch: {
      label?: string;
      notes?: string | null;
      percentOff?: number;
      active?: boolean;
      duration?: "forever" | "repeating";
      durationInMonths?: number | null;
      cardRequired?: boolean;
      appliesToPlans?: ("coach" | "coach_pro")[];
    },
  ) => {
    try {
      await update({ data: { code: c, ...patch } });
      await qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const updatePercent = (c: string, next: number) =>
    updateField(c, { percentOff: next });



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

  let currentEnv: "sandbox" | "live" | null = null;
  try {
    currentEnv = getStripeEnvironment();
  } catch {
    currentEnv = null;
  }
  const envLabel = currentEnv === "live" ? "Live" : currentEnv === "sandbox" ? "Test" : "Not configured";
  const envColorClass =
    currentEnv === "live"
      ? "bg-pen-pink-wash text-pen-pink-ink"
      : currentEnv === "sandbox"
        ? "bg-pen-pool-wash text-pen-pool-ink"
        : "bg-elevated text-text-tertiary";

  const unsyncedInCurrentEnv = currentEnv
    ? codes.filter(
        (r) =>
          (r.percent_off ?? 0) > 0 &&
          !(currentEnv === "live" ? r.stripe_promo_id_live : r.stripe_promo_id_sandbox),
      )
    : [];



  const handleBulkSync = async () => {
    if (!currentEnv || unsyncedInCurrentEnv.length === 0) return;
    setBulkSyncing(true);
    let ok = 0;
    let fail = 0;
    for (const row of unsyncedInCurrentEnv) {
      try {
        const res = await sync({ data: { code: row.code, environment: currentEnv } });
        if ("error" in res && res.error) fail++;
        else ok++;
      } catch {
        fail++;
      }
    }
    setBulkSyncing(false);
    await qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    if (fail === 0) toast.success(`Created ${ok} code${ok === 1 ? "" : "s"} in ${envLabel.toLowerCase()}`);
    else toast.error(`${ok} created, ${fail} failed in ${envLabel.toLowerCase()}`);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <Link
          to="/admin"
          search={{ test: false }}
          className="text-xs font-semibold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          ← Admin
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-h1 text-text-primary">Promo codes</h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${envColorClass}`}>
            You're viewing: {envLabel}
          </span>
        </div>
        <div className="space-y-1.5 text-sm text-text-secondary max-w-3xl">
          <p>
            Promo codes do two things: track who signed up with them, and (optionally) discount checkout by a set %.
          </p>
          <p>
            Any code with a discount has to be created in Stripe once for <strong className="text-text-primary">test</strong> (preview) and once for <strong className="text-text-primary">live</strong> (published site) before checkout can apply it. The Stripe column shows where each code is ready.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-text-tertiary">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-pen-tennis" /> ready in that environment
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-divider" /> not created yet — click Sync on that row
            </span>
          </div>
        </div>
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

          <div className="space-y-1.5 sm:col-span-2 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={duration === "forever" ? "default" : "secondary"}
                  onClick={() => setDuration("forever")}
                >
                  Forever
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={duration === "repeating" ? "default" : "secondary"}
                  onClick={() => setDuration("repeating")}
                >
                  Repeating
                </Button>
                {duration === "repeating" && (
                  <>
                    <span className="text-xs text-text-tertiary self-center">for</span>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={durationInMonths}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setDurationInMonths(
                          Number.isFinite(n) ? Math.min(60, Math.max(1, Math.round(n))) : 1,
                        );
                      }}
                      className="h-8 w-20 text-right font-mono text-xs"
                      aria-label="Months"
                    />
                  </>
                )}
                <span className="text-xs text-text-tertiary self-center">
                  {duration === "repeating" ? "months" : ""}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={appliesToPlans.includes("coach") ? "default" : "secondary"}
                  onClick={() => togglePlanInNew("coach")}
                >
                  Coach
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={appliesToPlans.includes("coach_pro") ? "default" : "secondary"}
                  onClick={() => togglePlanInNew("coach_pro")}
                >
                  Coach Pro
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="new-card-required"
                checked={cardRequired}
                onCheckedChange={(v) => setCardRequired(v === true)}
              />
              <Label htmlFor="new-card-required" className="cursor-pointer">
                Card required at checkout
              </Label>
              <span className="text-xs text-text-tertiary">
                Off = 100% off codes can start without a card on file.
              </span>
            </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <h2 className="font-display text-h3 text-text-primary">All codes</h2>
          {currentEnv && unsyncedInCurrentEnv.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={bulkSyncing}
              onClick={() => void handleBulkSync()}
            >
              {bulkSyncing
                ? `Creating in ${envLabel.toLowerCase()}…`
                : `Create ${unsyncedInCurrentEnv.length} unsynced code${unsyncedInCurrentEnv.length === 1 ? "" : "s"} in ${envLabel.toLowerCase()}`}
            </Button>
          )}
        </div>

        {codes.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-secondary">No codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider text-left text-text-tertiary">
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-5 py-3">Code</Eyebrow>
                  
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3">Duration</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3">Plans</Eyebrow>
                  <Eyebrow as="th" size="caption" tone="tertiary" weight="normal" tracking="wide" className="px-3 py-3 text-center">Card</Eyebrow>
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
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => setDetailCode(row.code)}
                          className="font-mono uppercase tracking-widest text-text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-accent rounded"
                          title="Open details"
                        >
                          {row.code}
                        </button>
                      </td>

                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <Button
                            type="button"
                            size="sm"
                            variant={row.duration === "forever" ? "default" : "secondary"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() =>
                              void updateField(row.code, {
                                duration: "forever",
                                durationInMonths: null,
                              })
                            }
                          >
                            Forever
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={row.duration === "repeating" ? "default" : "secondary"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() =>
                              void updateField(row.code, {
                                duration: "repeating",
                                durationInMonths: row.duration_in_months ?? 3,
                              })
                            }
                          >
                            Repeating
                          </Button>
                          {row.duration === "repeating" && (
                            <>
                              <Input
                                type="number"
                                min={1}
                                max={60}
                                step={1}
                                defaultValue={row.duration_in_months ?? 3}
                                onBlur={(e) => {
                                  const n = Number(e.target.value);
                                  const clamped = Number.isFinite(n)
                                    ? Math.min(60, Math.max(1, Math.round(n)))
                                    : 1;
                                  if (clamped !== (row.duration_in_months ?? 0)) {
                                    void updateField(row.code, {
                                      durationInMonths: clamped,
                                    });
                                  }
                                }}
                                className="h-6 w-14 text-right font-mono text-[11px]"
                                aria-label={`Months for ${row.code}`}
                              />
                              <span className="text-text-tertiary">mo</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          {(["coach", "coach_pro"] as const).map((plan) => {
                            const current = (row.applies_to_plans ?? []) as string[];
                            const on = current.includes(plan);
                            return (
                              <Button
                                key={plan}
                                type="button"
                                size="sm"
                                variant={on ? "default" : "secondary"}
                                className="h-6 px-2 text-[11px]"
                                onClick={() => {
                                  const next = on
                                    ? current.filter((p) => p !== plan)
                                    : [...current, plan];
                                  if (!next.length) {
                                    toast.error("At least one plan is required");
                                    return;
                                  }
                                  void updateField(row.code, {
                                    appliesToPlans: next as ("coach" | "coach_pro")[],
                                  });
                                }}
                              >
                                {plan === "coach_pro" ? "Coach Pro" : "Coach"}
                              </Button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-center">
                        <Switch
                          checked={row.card_required !== false}
                          onCheckedChange={(v) =>
                            void updateField(row.code, { cardRequired: v === true })
                          }
                          aria-label={`Card required for ${row.code}`}
                        />
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
                        {(() => {
                          const hasDiscount = (row.percent_off ?? 0) > 0;
                          if (!hasDiscount) {
                            return (
                              <div className="text-text-tertiary">Attribution only</div>
                            );
                          }
                          const mintedHere =
                            currentEnv === "live" ? mintedLive : mintedSandbox;
                          const otherEnvLabel = currentEnv === "live" ? "test" : "live";
                          const mintedOther =
                            currentEnv === "live" ? mintedSandbox : mintedLive;
                          let statusLabel = "Not created yet";
                          let dotClass = "bg-divider";
                          let toneClass = "text-text-tertiary";
                          if (mintedSandbox && mintedLive) {
                            statusLabel = "Ready in test & live";
                            dotClass = "bg-pen-tennis";
                            toneClass = "text-text-primary";
                          } else if (mintedSandbox) {
                            statusLabel = "Ready in test only";
                            dotClass = "bg-pen-orange";
                            toneClass = "text-text-primary";
                          } else if (mintedLive) {
                            statusLabel = "Ready in live only";
                            dotClass = "bg-pen-orange";
                            toneClass = "text-text-primary";
                          }
                          return (
                            <div className="space-y-1.5">
                              <div className={`flex items-center gap-1.5 ${toneClass}`}>
                                <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                                <span>{statusLabel}</span>
                              </div>
                              {currentEnv && (
                                <Button
                                  size="sm"
                                  variant={mintedHere ? "ghost" : "secondary"}
                                  className="h-6 px-2 text-[11px]"
                                  disabled={syncingCode === row.code}
                                  onClick={() => void handleSync(row.code)}
                                  title={
                                    mintedHere
                                      ? `Already created in ${envLabel.toLowerCase()}. Also needs creating in ${otherEnvLabel}? Open this page on the ${otherEnvLabel} site.`
                                      : `Creates this code in Stripe ${envLabel.toLowerCase()}.`
                                  }
                                >
                                  {syncingCode === row.code
                                    ? "Working…"
                                    : mintedHere
                                      ? `Re-sync in ${envLabel.toLowerCase()}`
                                      : `Create in ${envLabel.toLowerCase()}`}
                                </Button>
                              )}
                              {currentEnv && !mintedOther && (
                                <div className="text-[11px] text-text-tertiary">
                                  Still needs {otherEnvLabel}: open this page on the {otherEnvLabel} site.
                                </div>
                              )}
                            </div>
                          );
                        })()}
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

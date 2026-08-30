import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminGetPlanShareToken } from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

const SITE_ORIGIN = "https://gradus.training";

export interface AdminActivePlan {
  id: string;
  title: string;
  athleteName: string | null;
  shareToken: string | null;
}

export function PlanShareLinks({ plans }: { plans: AdminActivePlan[] }) {
  const fn = useServerFn(adminGetPlanShareToken);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied", { description: url });
    } catch {
      toast.success("Share link", { description: url });
    }
  };

  const onClick = async (planId: string, existing: string | null) => {
    const token = existing ?? tokens[planId];
    if (token) return copy(`${SITE_ORIGIN}/p/${token}`);
    setBusy(planId);
    try {
      const res = await fn({ data: { planId } });
      setTokens((t) => ({ ...t, [planId]: res.token }));
      await copy(`${SITE_ORIGIN}/p/${res.token}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't create share link");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
        Active plans ({plans.length})
      </Eyebrow>
      {plans.length === 0 ? (
        <p className="mt-1 text-sm text-text-secondary">None</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {plans.map((p) => {
            const token = p.shareToken ?? tokens[p.id] ?? null;
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-divider bg-elevated px-3 py-2"
              >
                <span className="text-sm text-text-primary">
                  {p.title}
                  {p.athleteName ? (
                    <span className="text-text-secondary"> — {p.athleteName}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy === p.id}
                  onClick={() => onClick(p.id, p.shareToken)}
                >
                  {busy === p.id ? "Creating…" : token ? "Copy share link" : "Create share link"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

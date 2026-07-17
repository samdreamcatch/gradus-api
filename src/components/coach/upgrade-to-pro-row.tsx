import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { SettingsButtonRow } from "@/components/settings/primitives";
import { isCoachProAvailable } from "@/lib/paywall-flag";

/**
 * Shared "Upgrade to Coach Pro" row used by both the Founding Coach block
 * and the paid Coach block in settings. While Coach Pro isn't purchasable,
 * the row is disabled with a SOON chip. Once `VITE_COACH_PRO_ENABLED=true`,
 * clicking navigates to the paywall pre-selected to Coach Pro.
 */
export function UpgradeToProRow() {
  const navigate = useNavigate();
  const available = isCoachProAvailable();

  const description = available
    ? "$70/mo or $59.50/mo billed yearly — save 15%."
    : "Coming soon — advanced scheduling, multi-coach visibility, up to 50 athletes.";

  return (
    <SettingsButtonRow
      icon={<Sparkles className="size-4" />}
      label="Upgrade to Coach Pro"
      description={description}
      tone="accent"
      disabled={!available}
      onClick={() => {
        if (!available) return;
        navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } });
      }}
      trailing={
        !available ? (
          <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
            Soon
          </span>
        ) : undefined
      }
    />
  );
}

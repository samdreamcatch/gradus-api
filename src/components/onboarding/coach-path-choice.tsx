import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, User, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { getOrganizationByInviteCode } from "@/lib/coach-org.functions";
import { cn } from "@/lib/utils";

export type CoachPath = "individual" | "club";

export interface CoachPathValue {
  path: CoachPath | null;
  promoCode: string;
  orgCode: string;
  orgName: string | null;
  orgVerified: boolean;
}

interface Props {
  value: CoachPathValue;
  onChange: (next: CoachPathValue) => void;
}

/**
 * First step of coach onboarding: pick Individual (pay) or Club (skip payment).
 * Each choice expands its own inline detail — promo code for individuals,
 * organization invite code for club coaches.
 */
export function CoachPathChoice({ value, onChange }: Props) {
  const lookup = useServerFn(getOrganizationByInviteCode);
  const [lookupState, setLookupState] = useState<
    "idle" | "checking" | "ok" | "notfound"
  >(value.orgVerified ? "ok" : "idle");

  const setPath = (path: CoachPath) => {
    onChange({ ...value, path });
  };

  // Auto-verify the org code as soon as it hits 8 chars.
  useEffect(() => {
    if (value.path !== "club") return;
    const trimmed = value.orgCode.trim().toUpperCase();
    if (trimmed.length !== 8 || !/^[A-Z2-9]{8}$/.test(trimmed)) {
      setLookupState(trimmed.length === 0 ? "idle" : "idle");
      if (value.orgVerified || value.orgName) {
        onChange({ ...value, orgName: null, orgVerified: false });
      }
      return;
    }
    if (value.orgVerified && value.orgName) return;
    let cancelled = false;
    setLookupState("checking");
    (async () => {
      try {
        const res = await lookup({ data: { code: trimmed } });
        if (cancelled) return;
        if (res.found) {
          setLookupState("ok");
          onChange({
            ...value,
            orgCode: trimmed,
            orgName: res.name,
            orgVerified: true,
          });
        } else {
          setLookupState("notfound");
          onChange({ ...value, orgName: null, orgVerified: false });
        }
      } catch {
        if (cancelled) return;
        setLookupState("notfound");
        onChange({ ...value, orgName: null, orgVerified: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.orgCode, value.path]);

  return (
    <div className="space-y-4">
      <PathCard
        selected={value.path === "individual"}
        onSelect={() => setPath("individual")}
        icon={<User className="h-6 w-6" />}
        title="Individual coach"
        blurb="You'll subscribe to Gradus directly. Add a promo code if you have one."
      >
        {value.path === "individual" && (
          <div className="mt-4 border-t border-divider pt-4">
            <PromoCodeField
              value={value.promoCode}
              onChange={(v) => onChange({ ...value, promoCode: v })}
            />
          </div>
        )}
      </PathCard>

      <PathCard
        selected={value.path === "club"}
        onSelect={() => setPath("club")}
        icon={<Building2 className="h-6 w-6" />}
        title="Part of a club, academy, or association"
        blurb="Enter your club's invite code — your club covers payment for you."
      >
        {value.path === "club" && (
          <div className="mt-4 space-y-2 border-t border-divider pt-4">
            <Label htmlFor="org-code">Organization invite code</Label>
            <div className="relative">
              <Input
                id="org-code"
                value={value.orgCode}
                onChange={(e) =>
                  onChange({
                    ...value,
                    orgCode: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z2-9]/g, "")
                      .slice(0, 8),
                    orgName: null,
                    orgVerified: false,
                  })
                }
                placeholder="8-character code"
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
                className="pr-10 font-mono uppercase tracking-widest"
              />
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                {lookupState === "checking" && (
                  <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                )}
                {lookupState === "ok" && (
                  <Check className="h-4 w-4 text-accent-ink" />
                )}
              </div>
            </div>
            {lookupState === "ok" && value.orgName && (
              <p className="text-sm text-text-primary">
                <span className="text-text-secondary">Linking with </span>
                <span className="font-semibold">{value.orgName}</span>
              </p>
            )}
            {lookupState === "notfound" && (
              <p className="text-xs text-destructive">
                We don't recognize that code. Check with your club admin.
              </p>
            )}
            <p className="text-xs text-text-tertiary">
              Don't have a code? Pick Individual coach above — you can switch later
              from Settings.
            </p>
          </div>
        )}
      </PathCard>
    </div>
  );
}

function PathCard({
  selected,
  onSelect,
  icon,
  title,
  blurb,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-elevated p-4 transition sm:p-5",
        selected ? "border-accent shadow-card" : "border-divider",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="press block w-full rounded-lg text-left focus-surface"
      >
        <div className="flex w-full items-start gap-3 sm:gap-4">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11",
              selected ? "bg-accent text-accent-foreground" : "bg-card text-text-secondary",
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-snug text-text-primary sm:text-base">
              {title}
            </h3>
            <p className="mt-1 text-sm leading-snug text-text-secondary">{blurb}</p>
          </div>
          <div
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2",
              selected ? "border-accent bg-accent" : "border-divider",
            )}
          >
            {selected && <Check className="h-full w-full p-0.5 text-accent-foreground" />}
          </div>
        </div>
      </button>
      {children}
    </div>
  );
}

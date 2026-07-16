import { useEffect, useState } from "react";
import { Building2, Check, User } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { OrgCodeField } from "@/components/onboarding/org-code-field";
import {
  OrgSearchCombobox,
  type OrgOption,
} from "@/components/onboarding/org-search-combobox";
import { OrgNotListedCard } from "@/components/onboarding/org-not-listed-card";
import { cn } from "@/lib/utils";

export type CoachPath = "individual" | "club";

/**
 * Onboarding path state. `orgId` is set once the coach picks a club from
 * search. `orgVerified` flips true when the invite code matches that org.
 */
export interface CoachPathValue {
  path: CoachPath | null;
  promoCode: string;
  orgId: string | null;
  orgName: string | null;
  orgCity: string | null;
  orgCode: string;
  orgVerified: boolean;
}

interface Props {
  value: CoachPathValue;
  onChange: (next: CoachPathValue) => void;
}

type ClubStep = "search" | "code" | "not_listed";

export function CoachPathChoice({ value, onChange }: Props) {
  // Derive the club sub-step from state so the parent stays authoritative.
  const [clubStep, setClubStep] = useState<ClubStep>(() =>
    value.orgId ? "code" : "search",
  );

  // If the parent replaces the org (e.g. prefill from URL), keep the sub-step
  // in sync without stomping user navigation.
  useEffect(() => {
    if (value.path === "club" && value.orgId && clubStep === "search") {
      setClubStep("code");
    }
  }, [value.path, value.orgId, clubStep]);

  const setPath = (path: CoachPath) => {
    onChange({ ...value, path });
    if (path === "club" && !value.orgId) setClubStep("search");
  };

  const handleOrgSelected = (org: OrgOption) => {
    onChange({
      ...value,
      path: "club",
      orgId: org.id,
      orgName: org.name,
      orgCity: org.city,
      orgCode: "",
      orgVerified: false,
    });
    setClubStep("code");
  };

  const handleChangeOrg = () => {
    onChange({
      ...value,
      orgId: null,
      orgName: null,
      orgCity: null,
      orgCode: "",
      orgVerified: false,
    });
    setClubStep("search");
  };

  const handleNotListed = () => {
    setClubStep("not_listed");
  };

  // "Continue as Individual" from the outreach card — flip path and clear
  // club state, keeping the parent onboarding flow unchanged from here.
  const handleFallbackToIndividual = () => {
    onChange({
      ...value,
      path: "individual",
      orgId: null,
      orgName: null,
      orgCity: null,
      orgCode: "",
      orgVerified: false,
    });
  };

  return (
    <div className="space-y-4">
      <PathCard
        selected={value.path === "individual"}
        onSelect={() => setPath("individual")}
        icon={<User className="h-6 w-6" />}
        title="Individual coach"
        blurb=""
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
        blurb=""
      >
        {value.path === "club" && (
          <div className="mt-4 space-y-4 border-t border-divider pt-4">
            {clubStep === "search" && (
              <OrgSearchCombobox
                selected={
                  value.orgId
                    ? {
                        id: value.orgId,
                        name: value.orgName ?? "",
                        city: value.orgCity,
                        region: null,
                        logoUrl: null,
                      }
                    : null
                }
                onSelect={handleOrgSelected}
                onNotListed={handleNotListed}
              />
            )}

            {clubStep === "code" && value.orgId && value.orgName && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="accent" size="small" caseSensitive>
                    <Building2 className="h-3.5 w-3.5" />
                    {value.orgName}
                  </Chip>
                  <button
                    type="button"
                    onClick={handleChangeOrg}
                    className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
                  >
                    Change
                  </button>
                </div>
                <OrgCodeField
                  orgId={value.orgId}
                  orgName={value.orgName}
                  value={value.orgCode}
                  onChange={(code, verified) =>
                    onChange({ ...value, orgCode: code, orgVerified: verified })
                  }
                />
                <button
                  type="button"
                  onClick={handleNotListed}
                  className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
                >
                  I don&apos;t have a code yet — message my club
                </button>
              </>
            )}

            {clubStep === "not_listed" && (
              <OrgNotListedCard
                initialClubName={value.orgName ?? ""}
                initialClubCity={value.orgCity ?? ""}
                onDone={handleFallbackToIndividual}
              />
            )}
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
        <div className="flex w-full items-center gap-3 sm:gap-4">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11",
              selected
                ? "bg-accent text-accent-foreground"
                : "bg-card text-text-secondary",
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-snug text-text-primary sm:text-base">
              {title}
            </h3>
            {blurb && (
              <p className="mt-1 text-sm leading-snug text-text-secondary">
                {blurb}
              </p>
            )}
          </div>
          <div
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2",
              selected ? "border-accent bg-accent" : "border-divider",
            )}
          >
            {selected && (
              <Check className="h-full w-full p-0.5 text-accent-foreground" />
            )}
          </div>
        </div>
      </button>
      {children}
    </div>
  );
}

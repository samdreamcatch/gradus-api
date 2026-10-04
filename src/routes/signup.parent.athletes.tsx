import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, HelpCircle, Plus, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";
import { ParentVerificationStep } from "@/components/consent/parent-verification-step";
import { DirectNotice } from "@/components/consent/direct-notice";
import { getMyParentVerification } from "@/lib/guardian-verification.functions";

import {
  getCoachByInviteCode,
  linkAthletesToCoach,
  startParentSignup,
} from "@/lib/parent-signup.functions";

const searchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/signup/parent/athletes")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ParentAthletesPage,
});

const PENDING_PARENT_COACH_CODE_KEY = "gradus.pendingParentCoachCode";

function ParentAthletesPage() {
  const { code: searchCode } = Route.useSearch();
  const navigate = useNavigate();
  const fetchCoach = useServerFn(getCoachByInviteCode);
  const linkAthletes = useServerFn(linkAthletesToCoach);
  const startSignup = useServerFn(startParentSignup);
  const fetchVerification = useServerFn(getMyParentVerification);
  // PRD §6.13 A1: after the parent profile exists and before any athlete is
  // linked, an unverified parent verifies once. The athletes typed so far
  // wait in state and are submitted the moment the verification lands.
  const [pendingLink, setPendingLink] = useState<{
    code: string | null;
    athletes: { firstName: string; lastName: string; birthdate: string }[];
    effectiveCode: string | undefined;
  } | null>(null);

  // Editable coach-invite code. Prefill from the `?code=` URL param (set by
  // /signup/parent when it forwarded a `/i/CODE` invite) or from the
  // sessionStorage stash that survives the Google OAuth round-trip.
  const [code, setCode] = useState<string>(searchCode ?? "");
  useEffect(() => {
    if (searchCode) {
      setCode(searchCode);
      return;
    }
    try {
      const stashed = sessionStorage.getItem(PENDING_PARENT_COACH_CODE_KEY);
      if (stashed && /^[A-Z2-9]{8}$/.test(stashed)) {
        setCode(stashed);
        navigate({ to: "/signup/parent/athletes", search: { code: stashed }, replace: true });
      }
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem(PENDING_PARENT_COACH_CODE_KEY);
    } catch {
      /* ignore */
    }
  }, [searchCode, navigate]);

  const trimmedCode = code.trim().toUpperCase();
  const codeIsFull = /^[A-Z2-9]{8}$/.test(trimmedCode);
  const codeInvalid = trimmedCode.length > 0 && !codeIsFull;

  const {
    data: coach,
    isLoading,
    error: coachError,
  } = useQuery({
    queryKey: ["coach-by-code", codeIsFull ? trimmedCode : null],
    queryFn: () => fetchCoach({ data: { code: trimmedCode } }),
    enabled: codeIsFull,
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [athletes, setAthletes] = useState<
    { firstName: string; lastName: string; birthdate: string }[]
  >([{ firstName: "", lastName: "", birthdate: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasPrefill = Boolean(code) || Boolean(promoCode);
  const [codesOpen, setCodesOpen] = useState<boolean>(hasPrefill);
  useEffect(() => {
    if (hasPrefill) setCodesOpen(true);
  }, [hasPrefill]);

  const updateAthlete = (i: number, field: "firstName" | "lastName" | "birthdate", v: string) => {
    setAthletes((arr) => arr.map((a, idx) => (idx === i ? { ...a, [field]: v } : a)));
  };
  const addAthlete = () =>
    setAthletes((arr) => [...arr, { firstName: "", lastName: "", birthdate: "" }]);
  const removeAthlete = (i: number) =>
    setAthletes((arr) => (arr.length === 1 ? arr : arr.filter((_, idx) => idx !== i)));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (codeInvalid) {
      setError("Coach invite code must be 8 characters, or leave it blank.");
      return;
    }

    const parentFirst = firstName.trim();
    const parentLast = lastName.trim();
    if (!parentFirst || !parentLast) {
      setError("Please enter your first and last name.");
      return;
    }

    const cleaned = athletes
      .map((a) => ({
        firstName: a.firstName.trim(),
        lastName: a.lastName.trim(),
        birthdate: a.birthdate,
      }))
      .filter((a) => a.firstName && a.lastName && a.birthdate);
    if (cleaned.length === 0) {
      setError("Add at least one athlete with name and birthdate.");
      return;
    }

    setSubmitting(true);
    try {
      // Stash any typed promo code; the `_authenticated` layout auto-applies
      // it on the next authed page load (see src/routes/_authenticated.tsx).
      if (promoCode.trim()) savePendingPromoCode(promoCode);

      const effectiveCode = codeIsFull ? trimmedCode : undefined;
      const { code: normalized } = await startSignup({
        data: { firstName: parentFirst, lastName: parentLast, code: effectiveCode },
      });
      const linkInput = { code: normalized ?? effectiveCode ?? null, athletes: cleaned };
      const verification = await fetchVerification();
      if (verification && verification.required && !verification.verified) {
        setPendingLink({ ...linkInput, effectiveCode });
        return;
      }
      await finishLink(linkInput, effectiveCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const finishLink = async (
    linkInput: {
      code: string | null;
      athletes: { firstName: string; lastName: string; birthdate: string }[];
    },
    effectiveCode: string | undefined,
  ) => {
    await linkAthletes({ data: linkInput });
    navigate({
      to: "/signup/parent/goals",
      search: effectiveCode ? { code: effectiveCode } : {},
    });
  };

  if (pendingLink) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
          <ParentVerificationStep
            athleteName={pendingLink.athletes[0]?.firstName ?? null}
            onVerified={() => {
              const { effectiveCode, ...linkInput } = pendingLink;
              setPendingLink(null);
              setSubmitting(true);
              finishLink(linkInput, effectiveCode)
                .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
                .finally(() => setSubmitting(false));
            }}
          />
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    );
  }

  const coachName = coach ? `${coach.firstName} ${coach.lastName}`.trim() : null;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-6 text-center">
          {codeIsFull ? (
            <>
              <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
                You&apos;re connecting to
              </p>
              {isLoading ? (
                <p className="mt-2 text-text-tertiary">Loading coach…</p>
              ) : coachError ? (
                <p className="mt-2 text-sm text-destructive">{(coachError as Error).message}</p>
              ) : (
                <>
                  <h1 className="mt-2 font-display text-3xl text-text-primary">
                    Coach {coachName}
                  </h1>
                  {coach && coach.sports.length > 0 && (
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {coach.sports.map((s) => (
                        <Chip key={s} tone="muted" tracking="wide">
                          {s}
                        </Chip>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <h1 className="mt-2 font-display text-3xl text-text-primary">Create your Profiles</h1>

              <p className="mt-2 text-sm text-text-secondary">
                Add yourself and each athlete in your family.
              </p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Your name</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={80}
                required
                autoComplete="given-name"
                aria-label="Your first name"
                placeholder="First name"
              />
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={80}
                required
                autoComplete="family-name"
                aria-label="Your last name"
                placeholder="Last name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {codeIsFull
                ? `Which of your athletes train${athletes.length > 1 ? "" : "s"} with${coachName ? ` Coach ${coachName}` : " this coach"}?`
                : `Your athlete${athletes.length > 1 ? "s" : ""}`}
            </Label>
            {codeIsFull && (
              <p className="text-xs text-text-tertiary">
                Add only the athletes connected to this coach. You can link other coaches later.
              </p>
            )}

            <div className="space-y-3 pt-1">
              {athletes.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={a.firstName}
                        onChange={(e) => updateAthlete(i, "firstName", e.target.value)}
                        maxLength={80}
                        required={i === 0}
                        aria-label={`Athlete ${i + 1} first name`}
                        placeholder="First name"
                      />
                      <Input
                        value={a.lastName}
                        onChange={(e) => updateAthlete(i, "lastName", e.target.value)}
                        maxLength={80}
                        required={i === 0}
                        aria-label={`Athlete ${i + 1} last name`}
                        placeholder="Last name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Your athlete's birthday</Label>
                      <Input
                        type="date"
                        value={a.birthdate}
                        onChange={(e) => updateAthlete(i, "birthdate", e.target.value)}
                        required={i === 0}
                        max={new Date().toISOString().slice(0, 10)}
                        aria-label={`Athlete ${i + 1} birthday`}
                        placeholder="Birthday"
                      />
                    </div>
                  </div>
                  {athletes.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAthlete(i)}
                      aria-label={`Remove athlete ${i + 1}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addAthlete}
              className="text-accent-ink"
            >
              <Plus className="size-4" /> Add another athlete
            </Button>
          </div>

          <DirectNotice
            athleteName={
              athletes.length > 1
                ? "your athletes"
                : athletes[0]?.firstName.trim() || "your athlete"
            }
            consentAct
          />

          <Collapsible open={codesOpen} onOpenChange={setCodesOpen} className="space-y-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="flex w-full items-center justify-between px-2 text-accent-ink"
              >
                <span className="flex items-center gap-2">
                  Optional — enter a coach or promo code
                  {!codesOpen && hasPrefill && <Badge variant="secondary">Code applied</Badge>}
                </span>
                <ChevronDown
                  className={`size-4 transition-transform ${codesOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="coach-invite-code" className="flex items-center gap-2">
                    Coach invite code
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
                      Optional
                    </Badge>
                  </Label>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="More about coach invite code"
                          className="text-text-tertiary hover:text-text-secondary"
                        >
                          <HelpCircle className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Have a coach&apos;s 8-character code? Enter it to link your athlete now. You
                        can skip this and add a coach later.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="coach-invite-code"
                  name="coach-invite-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                  maxLength={8}
                  placeholder="––––––––"
                  className="font-mono tracking-[0.25em] uppercase"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                />
              </div>

              <PromoCodeField value={promoCode} onChange={setPromoCode} />
            </CollapsibleContent>
          </Collapsible>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={submitting || (codeIsFull && !coach)}>
            {submitting ? "Saving..." : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}

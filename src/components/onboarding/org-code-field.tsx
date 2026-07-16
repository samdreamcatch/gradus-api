import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyOrgCodeForOrg } from "@/lib/coach-org.functions";

interface Props {
  /** Organization the coach picked from the search — code must match this org. */
  orgId: string;
  orgName: string;
  value: string;
  onChange: (nextCode: string, verified: boolean) => void;
  id?: string;
}

/**
 * 8-char organization invite code input. Auto-verifies against the chosen
 * `orgId` on the server as soon as the code reaches 8 characters. Extracted
 * from the original inline block so both onboarding and future admin surfaces
 * can share it without duplication.
 */
export function OrgCodeField({
  orgId,
  orgName,
  value,
  onChange,
  id = "org-code",
}: Props) {
  const verify = useServerFn(verifyOrgCodeForOrg);
  const [state, setState] = useState<
    "idle" | "checking" | "ok" | "mismatch" | "unknown"
  >("idle");

  useEffect(() => {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length === 0) {
      setState("idle");
      return;
    }
    if (!/^[A-Z2-9]{8}$/.test(trimmed)) {
      setState("idle");
      onChange(trimmed, false);
      return;
    }
    let cancelled = false;
    setState("checking");
    void (async () => {
      try {
        const res = await verify({ data: { orgId, code: trimmed } });
        if (cancelled) return;
        if (res.ok) {
          setState("ok");
          onChange(trimmed, true);
        } else {
          setState(res.reason === "mismatch" ? "mismatch" : "unknown");
          onChange(trimmed, false);
        }
      } catch {
        if (cancelled) return;
        setState("unknown");
        onChange(trimmed, false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, orgId]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Club invite code</Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z2-9]/g, "")
                .slice(0, 8),
              false,
            )
          }
          placeholder="8-character code"
          maxLength={8}
          autoComplete="off"
          spellCheck={false}
          className="pr-10 font-mono uppercase tracking-widest"
        />
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          {state === "checking" && (
            <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
          )}
          {state === "ok" && <Check className="h-4 w-4 text-accent-ink" />}
        </div>
      </div>
      {state === "ok" && (
        <p className="text-sm text-text-primary">
          <span className="text-text-secondary">Code confirmed for </span>
          <span className="font-semibold">{orgName}</span>
        </p>
      )}
      {state === "mismatch" && (
        <p className="text-xs text-destructive">
          That code isn&apos;t for {orgName}. Double-check with your club
          coordinator.
        </p>
      )}
      {state === "unknown" && (
        <p className="text-xs text-destructive">
          We don&apos;t recognize that code.
        </p>
      )}
    </div>
  );
}

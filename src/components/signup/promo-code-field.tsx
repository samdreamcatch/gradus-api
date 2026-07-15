import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PromoCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional error message to display below the input (e.g. after submit validation). */
  error?: string | null;
  className?: string;
  id?: string;
}

/**
 * Reusable "Promo code (optional)" input for every signup entry point.
 * Uppercases input, trims, caps length at 32. Never blocks submission —
 * validation happens server-side after signup completes.
 */
export function PromoCodeField({
  value,
  onChange,
  error,
  className,
  id = "promo-code",
}: PromoCodeFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>Promo code (optional)</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 32))}
        maxLength={32}
        autoComplete="off"
        spellCheck={false}
        className="font-mono uppercase tracking-widest"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Local hook that stores the code and a validation error. Call `applyAfterSignup`
 * with the `applyPromoCodeToMyProfile` server fn after the signup succeeds; it
 * returns true if the code was accepted (or empty), false if unrecognized.
 */
export function usePromoCodeField() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const applyAfterSignup = async (
    applyFn: (args: { data: { code?: string } }) => Promise<{ applied: boolean }>,
  ): Promise<boolean> => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return true;
    try {
      const res = await applyFn({ data: { code: trimmed } });
      if (!res.applied) {
        setError("We don't recognize that code — you can leave it blank or double-check.");
        return false;
      }
      setError(null);
      return true;
    } catch {
      // Silent on network hiccup — never block signup on this.
      return true;
    }
  };

  return { code, setCode, error, setError, applyAfterSignup };
}

import { useState } from "react";
import { KeyRound, Mail, AtSign, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import {
  SettingsGroup,
  SettingsList,
  SettingsButtonRow,
} from "@/components/settings/primitives";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendlyError(err: unknown, fallback: string) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/rate|over_email_send/i.test(msg)) {
    return "Too many email requests right now. Please try again in a few minutes.";
  }
  return msg || fallback;
}

/**
 * Shared account & security actions rendered inside its own SettingsGroup.
 * Drop <AccountSecuritySection /> into any settings page.
 */
export function AccountSecuritySection() {
  const email = useCurrentUserEmail();
  const [sendingReset, setSendingReset] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  async function sendReset() {
    if (!email) {
      toast.error("We couldn't find your email address.");
      return;
    }
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(`Password reset link sent to ${email}.`);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't send reset email."));
    } finally {
      setSendingReset(false);
    }
  }

  async function sendMagicLink() {
    if (!email) {
      toast.error("We couldn't find your email address.");
      return;
    }
    setSendingMagic(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      toast.success(`Magic link sent to ${email}.`);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't send magic link."));
    } finally {
      setSendingMagic(false);
    }
  }

  return (
    <>
      <SettingsGroup label="Account & security">
        <SettingsList>
          <SettingsButtonRow
            icon={
              sendingReset ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )
            }
            label="Reset password"
            description="Email yourself a link to set a new password."
            disabled={sendingReset || !email}
            onClick={sendReset}
          />
          <SettingsButtonRow
            icon={
              sendingMagic ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )
            }
            label="Send magic link"
            description="Email yourself a one-tap sign-in link."
            disabled={sendingMagic || !email}
            onClick={sendMagicLink}
          />
          <SettingsButtonRow
            icon={<AtSign className="size-4" />}
            label="Change email"
            description="Both your current and new address will need to confirm."
            onClick={() => setChangeOpen(true)}
          />
        </SettingsList>
      </SettingsGroup>

      <ChangeEmailSheet
        open={changeOpen}
        onOpenChange={setChangeOpen}
        currentEmail={email}
      />
    </>
  );
}

/* ---------- Change email sheet ---------- */

type ChangeStep = "form" | "reauth";

function ChangeEmailSheet({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string | null;
}) {
  const vv = useVisualViewport();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
      }}
    >
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto border-t border-divider shadow-page"
        style={{
          bottom: vv.keyboardInset,
          maxHeight: Math.round(vv.height * 0.9),
        }}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Change email</SheetTitle>
          <SheetDescription>
            We'll send a confirmation to both your current and new address. The
            change takes effect once both are confirmed.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <ChangeEmailBody
            currentEmail={currentEmail}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ChangeEmailBody({
  currentEmail,
  onClose,
}: {
  currentEmail: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ChangeStep>("form");
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [nonce, setNonce] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedNew = newEmail.trim();
  const trimmedConfirm = confirmEmail.trim();
  const emailOk =
    /.+@.+\..+/.test(trimmedNew) && trimmedNew.toLowerCase() === trimmedConfirm.toLowerCase();
  const sameAsCurrent =
    currentEmail && trimmedNew.toLowerCase() === currentEmail.toLowerCase();

  async function submitChange(usingNonce?: string) {
    if (!emailOk || sameAsCurrent) return;
    setSubmitting(true);
    try {
      const payload: { email: string; nonce?: string } = { email: trimmedNew };
      if (usingNonce) payload.nonce = usingNonce;
      const { error } = await supabase.auth.updateUser(payload);
      if (error) {
        // Supabase asks for reauth on sensitive changes on some projects.
        const code = (error as { code?: string }).code ?? "";
        const msg = error.message ?? "";
        if (
          code === "reauthentication_needed" ||
          /reauth/i.test(code) ||
          /reauthenticat/i.test(msg)
        ) {
          const { error: reauthErr } = await supabase.auth.reauthenticate();
          if (reauthErr) throw reauthErr;
          toast.message("We sent a 6-digit code to your current email.", {
            description: "Enter it below to confirm the change.",
          });
          setStep("reauth");
          return;
        }
        throw error;
      }
      toast.success("Confirmation sent. Check both inboxes to finish the change.");
      onClose();
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't update email."));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "reauth") {
    return (
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="reauth-nonce" className="text-xs">
            6-digit code
          </Label>
          <Input
            id="reauth-nonce"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={nonce}
            onChange={(e) => setNonce(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder="123456"
          />
          <p className="text-xs text-text-tertiary">
            Sent to {currentEmail ?? "your current email"}.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => submitChange(nonce)}
            disabled={submitting || nonce.length !== 6}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Confirming…
              </>
            ) : (
              "Confirm change"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Current email</Label>
        <Input value={currentEmail ?? ""} readOnly disabled />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-email" className="text-xs">
          New email
        </Label>
        <Input
          id="new-email"
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-email-confirm" className="text-xs">
          Confirm new email
        </Label>
        <Input
          id="new-email-confirm"
          type="email"
          autoComplete="email"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          placeholder="you@example.com"
        />
        {sameAsCurrent ? (
          <p className="text-xs text-destructive">
            That's the same as your current email.
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => submitChange()}
          disabled={submitting || !emailOk || !!sameAsCurrent}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Send confirmation"
          )}
        </Button>
      </div>
    </div>
  );
}

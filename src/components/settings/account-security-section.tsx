import { useState } from "react";
import { KeyRound, AtSign, Loader2, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  DELETE_CONFIRM_PHRASE,
  deleteMyAccount,
  getDeletionImpact,
} from "@/lib/account-deletion.functions";
import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { SettingsGroup, SettingsList, SettingsButtonRow } from "@/components/settings/primitives";
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
export function AccountSecuritySection({ showLabel = true }: { showLabel?: boolean } = {}) {
  const email = useCurrentUserEmail();
  const [sendingReset, setSendingReset] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      <SettingsGroup label={showLabel ? "Account & security" : undefined}>
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
          <SettingsButtonRow
            icon={<Trash2 className="size-4" />}
            label="Delete account"
            description="Permanently delete your account and personal data."
            tone="destructive"
            onClick={() => setDeleteOpen(true)}
          />
        </SettingsList>
      </SettingsGroup>

      <ChangeEmailSheet open={changeOpen} onOpenChange={setChangeOpen} currentEmail={email} />
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} currentEmail={email} />
    </>
  );
}

/* ---------- Delete account ---------- */

function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string | null;
}) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [choices, setChoices] = useState<Record<string, "keep" | "delete">>({});
  const deleteFn = useServerFn(deleteMyAccount);
  const impactFn = useServerFn(getDeletionImpact);
  const navigate = useNavigate();

  const { data: impact } = useQuery({
    queryKey: ["deletion-impact"],
    queryFn: () => impactFn(),
    enabled: open,
  });
  const minors = impact?.minors ?? [];

  const matches = typed.trim().toUpperCase() === DELETE_CONFIRM_PHRASE;

  async function confirmDelete() {
    if (!matches) return;
    setDeleting(true);
    try {
      const result = await deleteFn({
        data: {
          confirmPhrase: typed.trim(),
          minorChoices: minors.map((m) => ({
            athleteId: m.id,
            action: choices[m.id] ?? ("keep" as const),
          })),
        },
      });
      if (result && "ok" in result && result.ok === false) {
        toast.error(result.message);
        return;
      }
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't delete your account."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setTyped("");
          setChoices({});
        }
        onOpenChange(o);
      }}
    >
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>
                This is immediate and can't be undone. Your name, email and sign-in are deleted, any
                active subscription is cancelled, and your voice notes and uploads are removed.
              </p>
              <p>
                Shared history stays readable for the people you worked with — your messages remain
                in their threads with the content removed and no name attached.
              </p>
              <p>
                If you're a parent, athletes with another guardian on the account transfer to them.
                An athlete with no other guardian and no sign-in of their own is deleted along with
                their plans and practice log.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {minors.length > 0 ? (
          <div className="space-y-3 rounded-md border border-divider bg-elevated p-3">
            <p className="text-xs text-text-secondary">
              These athletes are under 18 and sign in themselves. You're the only adult on their
              account, so choose what happens next.
            </p>
            {minors.map((m) => (
              <div key={m.id} className="space-y-1.5">
                <p className="text-sm font-bold text-text-primary">{m.firstName}</p>
                <RadioGroup
                  value={choices[m.id] ?? "keep"}
                  onValueChange={(v) =>
                    setChoices((prev) => ({ ...prev, [m.id]: v as "keep" | "delete" }))
                  }
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="keep" id={`minor-keep-${m.id}`} className="mt-0.5" />
                    <Label
                      htmlFor={`minor-keep-${m.id}`}
                      className="text-xs font-normal leading-snug"
                    >
                      Keep sending copies to {m.guardianEmail ?? "my email"} — {m.firstName} keeps
                      their account and an adult stays on file.
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="delete" id={`minor-delete-${m.id}`} className="mt-0.5" />
                    <Label
                      htmlFor={`minor-delete-${m.id}`}
                      className="text-xs font-normal leading-snug"
                    >
                      Delete {m.firstName}'s account too — their sign-in, plans and practice log are
                      erased with mine.
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="delete-confirm-phrase" className="text-xs">
            Type {DELETE_CONFIRM_PHRASE} to confirm
          </Label>
          <Input
            id="delete-confirm-phrase"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={DELETE_CONFIRM_PHRASE}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || deleting}
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete my account"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            We'll send a confirmation to both your current and new address. The change takes effect
            once both are confirmed.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <ChangeEmailBody currentEmail={currentEmail} onClose={() => onOpenChange(false)} />
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
  const sameAsCurrent = currentEmail && trimmedNew.toLowerCase() === currentEmail.toLowerCase();

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
          <Button onClick={() => submitChange(nonce)} disabled={submitting || nonce.length !== 6}>
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
          <p className="text-xs text-destructive">That's the same as your current email.</p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={() => submitChange()} disabled={submitting || !emailOk || !!sameAsCurrent}>
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

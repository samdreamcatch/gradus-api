import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { resolveInviteCode, type InviteKind } from "@/lib/invite-resolve.functions";
import { claimParentInvite } from "@/lib/parent-signup.functions";
import { getMyRole } from "@/lib/parent-signup.functions";
import { claimAdultAthleteInvite } from "@/lib/adult-athlete-invite.functions";

/** localStorage key read by the athlete-onboarding coach step to prefill a
 *  pending coach invite code after signup. */
export const PENDING_COACH_INVITE_KEY = "gradus.pendingCoachInvite";
/** localStorage key already used by /signup/coach for parent invites. */
const PENDING_PARENT_INVITE_KEY = "gradus.pendingParentInvite";

const paramsSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/),
});

export const Route = createFileRoute("/i/$code")({
  parseParams: (raw) => paramsSchema.parse(raw),
  stringifyParams: (parsed) => ({ code: parsed.code }),
  component: InviteEntryPage,
});

type Role = "coach" | "parent" | "athlete" | null;
type Stage =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "role-picker"; code: string }
  | { kind: "wrong-role"; message: string }
  | { kind: "working" };

/**
 * Universal invite entry. `/i/CODE` figures out what the code is, whether
 * the user is signed in, and what to do next:
 *  - Signed out: routes to the right signup with the code attached (coach
 *    codes go through a small role picker first — parent vs adult athlete).
 *  - Signed in, right role: claims immediately when possible, or routes to
 *    the settings screen with the linking form pre-opened.
 *  - Signed in, wrong role: friendly "not for your account" screen.
 */
function InviteEntryPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const resolve = useServerFn(resolveInviteCode);
  const roleFn = useServerFn(getMyRole);
  const claimParent = useServerFn(claimParentInvite);
  const claimAdultAthlete = useServerFn(claimAdultAthleteInvite);

  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: sessionRes }, resolved] = await Promise.all([
          supabase.auth.getSession(),
          resolve({ data: { code } }),
        ]);
        if (cancelled) return;
        const signedIn = !!sessionRes.session;

        if (!resolved.kind || !resolved.valid) {
          const msg =
            resolved.kind === "athlete" && resolved.used
              ? "This invite has already been used."
              : resolved.kind === "athlete" && resolved.expired
                ? "This invite has expired. Ask the sender for a new one."
                : "This invite link isn't valid.";
          setStage({ kind: "invalid", message: msg });
          return;
        }

        const kind = resolved.kind as InviteKind;

        // Signed-out: send them into the right signup with the code carried.
        if (!signedIn) {
          if (kind === "parent" || kind === "adult-athlete") {
            navigate({ to: "/signup/coach", search: { invite: code } });
            return;
          }
          if (kind === "athlete") {
            navigate({ to: "/signup/athlete/confirm", search: { code } });
            return;
          }
          // kind === "coach" → recipient could be a parent or an adult athlete.
          setStage({ kind: "role-picker", code });
          return;
        }

        // Signed-in: check role and act.
        setStage({ kind: "working" });
        const roleRes = await roleFn().catch(() => ({ role: null as Role }));
        if (cancelled) return;
        const role: Role = roleRes.role ?? null;

        if (kind === "parent") {
          // Recipient must be a coach.
          if (role !== "coach") {
            setStage({
              kind: "wrong-role",
              message:
                "This invite is for a coach. You're signed in as a " +
                (role ?? "different") +
                " account.",
            });
            return;
          }
          try {
            await claimParent({ data: { code } });
            toast.success("Linked to the parent's account");
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Couldn't claim invite";
            if (/already/i.test(msg)) toast.success("Already connected");
            else toast.error(msg);
          }
          qc.invalidateQueries();
          navigate({ to: "/coach" });
          return;
        }

        if (kind === "adult-athlete") {
          // Recipient must be a coach.
          if (role !== "coach") {
            setStage({
              kind: "wrong-role",
              message:
                "This invite is for a coach. You're signed in as a " +
                (role ?? "different") +
                " account.",
            });
            return;
          }
          try {
            await claimAdultAthlete({ data: { code } });
            toast.success("Linked to the athlete's account");
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Couldn't claim invite";
            if (/already/i.test(msg)) toast.success("Already connected");
            else toast.error(msg);
          }
          qc.invalidateQueries();
          navigate({ to: "/coach" });
          return;
        }

        if (kind === "coach") {
          // Recipient is a parent or adult athlete.
          if (role === "parent") {
            navigate({ to: "/parent/settings", search: { linkCoach: code } });
            return;
          }
          if (role === "athlete") {
            navigate({ to: "/athlete/settings", search: { linkCoach: code } });
            return;
          }
          if (role === "coach") {
            setStage({
              kind: "wrong-role",
              message:
                "This invite is for a parent or adult athlete. You're signed in as a coach.",
            });
            return;
          }
          // No role yet — send through the picker to complete signup.
          setStage({ kind: "role-picker", code });
          return;
        }

        // kind === "athlete" — signed-in athlete claim isn't supported here.
        setStage({
          kind: "wrong-role",
          message:
            "This is a new-athlete invite. Sign out and open the link in a fresh browser to claim it.",
        });
      } catch (e) {
        if (cancelled) return;
        setStage({
          kind: "invalid",
          message: e instanceof Error ? e.message : "Something went wrong",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-6 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            You've been invited to
          </p>
          <h1 className="mt-2">
            <Logo className="text-5xl" />
          </h1>
        </div>

        {stage.kind === "loading" || stage.kind === "working" ? (
          <p className="text-center text-sm text-text-secondary">Just a moment…</p>
        ) : stage.kind === "invalid" ? (
          <>
            <p className="text-center text-text-primary">{stage.message}</p>
            <div className="mt-6">
              <Button asChild variant="outline" className="w-full">
                <Link to="/">Go to Gradus</Link>
              </Button>
            </div>
          </>
        ) : stage.kind === "wrong-role" ? (
          <WrongRoleView message={stage.message} code={code} />
        ) : (
          <RolePicker code={stage.code} />
        )}
      </div>
    </div>
  );
}

function RolePicker({ code }: { code: string }) {
  // For coach-generated invites where we don't yet know if the recipient is
  // a parent or an adult athlete. Also stash the code in localStorage so the
  // adult-athlete onboarding coach step can prefill after signup.
  const stash = () => {
    try {
      localStorage.setItem(PENDING_COACH_INVITE_KEY, code);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-center text-text-primary">
        Are you signing up as a parent, or as an athlete over 18?
      </p>
      <div className="space-y-3">
        <Button asChild className="w-full">
          <Link
            to="/signup/parent"
            search={{ invite: code }}
            onClick={stash}
          >
            I'm a parent
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link
            to="/signup/athlete/adult"
            search={{ invite: code }}
            onClick={stash}
          >
            I'm an adult athlete (18+)
          </Link>
        </Button>
      </div>
    </div>
  );
}

function WrongRoleView({ message, code }: { message: string; code: string }) {
  const [signingOut, setSigningOut] = useState(false);
  const signOutAndRetry = async () => {
    setSigningOut(true);
    try {
      // Clear cached pending invites so the fresh session doesn't inherit them.
      try {
        localStorage.removeItem(PENDING_COACH_INVITE_KEY);
        localStorage.removeItem(PENDING_PARENT_INVITE_KEY);
      } catch {
        /* ignore */
      }
      await supabase.auth.signOut();
      // Reload back to this same URL so we run through the flow signed-out.
      window.location.href = `/i/${code}`;
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-center text-text-primary">{message}</p>
      <p className="text-center text-sm text-text-secondary">
        Sign out and open the link again to use a different account.
      </p>
      <Button
        onClick={signOutAndRetry}
        disabled={signingOut}
        className="w-full"
      >
        {signingOut ? "Signing out…" : "Sign out and continue"}
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/">Stay signed in</Link>
      </Button>
    </div>
  );
}

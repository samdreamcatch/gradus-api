import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { supabase } from "@/integrations/supabase/client";
import {
  listAthletesWithInviteCodes,
  getParentSignupStatus,
} from "@/lib/parent-signup.functions";

export const Route = createFileRoute("/_authenticated/parent/")({
  component: ParentHome,
});

function ParentHome() {
  const navigate = useNavigate();
  const fetchAthletes = useServerFn(listAthletesWithInviteCodes);
  const fetchStatus = useServerFn(getParentSignupStatus);

  // Resume-onboarding check runs in the component (not beforeLoad) so it
  // only fires after AuthGate has confirmed the session and the bearer
  // token is attached.
  const { data: status } = useQuery({
    queryKey: ["parent-signup-status"],
    queryFn: () => fetchStatus(),
  });

  useEffect(() => {
    if (!status) return;
    if (!status.hasParentProfile) return;
    if (status.hasAthletes) return;
    if (status.inviteCode) {
      navigate({
        to: "/signup/parent/athletes",
        search: { code: status.inviteCode },
      });
    } else {
      navigate({ to: "/signup/parent" });
    }
  }, [status, navigate]);

  const { data } = useQuery({
    queryKey: ["parent-athletes-invite"],
    queryFn: () => fetchAthletes(),
    enabled: !!status?.hasAthletes,
  });


  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 pb-24">
      <div className="flex items-center justify-between">
        <Logo className="text-4xl" />
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
      <h1 className="mt-6 font-display text-3xl text-text-primary">
        Welcome, parent.
      </h1>
      <p className="mt-3 text-text-secondary">
        Your athletes are linked to your coach. We&apos;ll build out your home
        screen in the next slice.
      </p>

      <section className="mt-6">
        <h2 className="font-display text-2xl text-text-primary">Invite your athletes</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Optional — only needed if your athlete will sign in to their own
          account. They can scan this code to join.
        </p>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {(data?.athletes ?? []).map((a) => (
            <AthleteInviteCard
              key={a.id}
              name={`${a.firstName} ${a.lastName}`}
              code={a.code}
              url={a.code ? `${origin}/signup/athlete?code=${a.code}` : null}
            />
          ))}
        </div>
      </section>
      <ParentBottomNav />
    </div>
  );
}

function AthleteInviteCard({
  name,
  code,
  url,
}: {
  name: string;
  code: string | null;
  url: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-2xl border border-divider bg-elevated p-5">
      <p className="font-display text-lg text-text-primary">{name}</p>
      {code && url ? (
        <>
          <div className="mt-4 flex items-center justify-center rounded-md bg-card p-4">
            <QRCodeSVG value={url} size={140} bgColor="transparent" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="font-mono text-sm tracking-[0.25em] uppercase text-text-secondary">
              {code}
            </span>
            <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy code">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-text-tertiary">Generating code…</p>
      )}
    </div>
  );
}

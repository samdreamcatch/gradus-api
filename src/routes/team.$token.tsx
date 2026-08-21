import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { previewGuardianInvite, claimGuardianInvite } from "@/lib/family-guardians.functions";

export const Route = createFileRoute("/family/$token")({
  head: () => ({
    meta: [
      { title: "Guardian invite — Gradus" },
      {
        name: "description",
        content: "Accept an invite to follow along with your athlete's training on Gradus.",
      },
      { property: "og:title", content: "Guardian invite — Gradus" },
      {
        property: "og:description",
        content: "Accept an invite to follow along with your athlete's training on Gradus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FamilyInvitePage,
});

function FamilyInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const preview = useServerFn(previewGuardianInvite);
  const claim = useServerFn(claimGuardianInvite);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["guardian-invite", token],
    queryFn: () => preview({ data: { token } }),
  });

  const handleAccept = async () => {
    setBusy(true);
    try {
      await claim({ data: { token } });
      toast.success("You've been added as a guardian.");
      await navigate({ to: "/parent/settings" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't accept that invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
        <Users className="size-6" />
      </div>
      {isLoading || signedIn === null ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !data?.found ? (
        <>
          <h1 className="font-display text-h2 text-text-primary">This invite isn't valid</h1>
          <p className="mt-2 text-sm text-text-secondary">
            It may have expired or already been used. Ask them to send a new one.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-h2 text-text-primary">
            {data.inviterName} invited you
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Join as a parent or guardian for {data.athleteName} on Gradus.
          </p>
          {signedIn ? (
            <Button type="button" className="mt-6" onClick={() => void handleAccept()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Accept invite"}
            </Button>
          ) : (
            <Button
              type="button"
              className="mt-6"
              onClick={() => void navigate({ to: "/login", search: { redirect: `/family/${token}` } })}
            >
              Sign in to accept
            </Button>
          )}
        </>
      )}
    </div>
  );
}

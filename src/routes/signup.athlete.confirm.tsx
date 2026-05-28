import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { SportChip } from "@/components/onboarding/sport-chip";
import { getAthleteInviteSummary } from "@/lib/athlete-signup.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/),
});

export const Route = createFileRoute("/signup/athlete/confirm")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteConfirmPage,
});

function AthleteConfirmPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const lookup = useServerFn(getAthleteInviteSummary);

  const { data, isLoading, error } = useQuery({
    queryKey: ["athlete-invite", code],
    queryFn: () => lookup({ data: { code } }),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <Logo className="text-5xl" />
          <p className="mt-6 font-display text-2xl text-text-primary">
            Does this look right?
          </p>
        </div>

        {isLoading && (
          <p className="text-center text-sm text-text-secondary">Looking up your invite...</p>
        )}

        {error && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Something went wrong"}
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link to="/signup/athlete" search={{ code: undefined }}>Try a different code</Link>
            </Button>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <div className="rounded-xl border border-divider bg-elevated p-6 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-text-tertiary">
                Athlete
              </p>
              <p className="mt-2 font-display text-3xl text-text-primary">
                {data.athleteFirstName} {data.athleteLastName}
              </p>

              {data.sports.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {data.sports.map((s) => (
                    <SportChip key={s} selected disabled>
                      {s}
                    </SportChip>
                  ))}
                </div>
              )}

              <p className="mt-6 text-sm text-text-secondary">
                Coached by{" "}
                <span className="font-semibold text-text-primary">
                  {data.coachFirstName} {data.coachLastName}
                </span>
              </p>
            </div>

            <div className="space-y-3">
              <Button
                className="w-full"
                onClick={() => navigate({ to: "/signup/athlete/account", search: { code } })}
              >
                That&apos;s me — continue
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link to="/signup/athlete" search={{ code: undefined }}>That&apos;s not me</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

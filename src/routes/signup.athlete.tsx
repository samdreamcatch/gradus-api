import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Logo } from "@/components/logo";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/).optional(),
});

export const Route = createFileRoute("/signup/athlete")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteSignupStub,
});

function AthleteSignupStub() {
  const { code } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card text-center">
        <Logo className="text-5xl" />
        <h1 className="mt-6 font-display text-2xl text-text-primary">
          Your parent invited you.
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Athlete signup is coming soon. Hold on to your invite code — you&apos;ll
          use it when accounts open up.
        </p>
        {code && (
          <p className="mt-6 font-mono text-lg tracking-[0.3em] uppercase text-accent-ink">
            {code}
          </p>
        )}
      </div>
    </div>
  );
}

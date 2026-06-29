import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TermsStep } from "@/components/onboarding/terms-step";

export const Route = createFileRoute("/signup/parent/terms")({
  component: ParentTermsPage,
});

function ParentTermsPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-card p-8 shadow-card sm:p-10">
        <TermsStep role="parent" onAccepted={() => navigate({ to: "/parent" })} />
      </div>
    </div>
  );
}

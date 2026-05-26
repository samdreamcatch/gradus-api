import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/_authenticated/parent")({
  component: ParentHome,
});

function ParentHome() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Logo className="text-4xl" />
      <h1 className="mt-6 font-display text-3xl text-text-primary">
        Welcome, parent.
      </h1>
      <p className="mt-3 text-text-secondary">
        Your athletes are linked to your coach. We&apos;ll build out your home
        screen in the next slice.
      </p>
    </div>
  );
}

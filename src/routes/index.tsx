import { createFileRoute, isRedirect, Link, redirect } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/logo";
import { getMyRole } from "@/lib/parent-signup.functions";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    try {
      // Internal admins take precedence — they may also be seeded as org
      // admins for testing, but should land in the internal panel.
      try {
        const { isAdmin } = await checkIsAdmin();
        if (isAdmin) throw redirect({ to: "/admin" });
      } catch (e) {
        if (isRedirect(e)) throw e;
      }
      const { role } = await getMyRole();
      if (role === "parent") throw redirect({ to: "/parent/plans" });
      if (role === "coach") throw redirect({ to: "/coach" });
      if (role === "athlete") throw redirect({ to: "/athlete" });
      if (role === "org_admin") throw redirect({ to: "/org-admin" });
    } catch (e) {
      if (isRedirect(e)) throw e;
      // Otherwise: show picker (e.g. role lookup failed).
    }
  },
  component: RolePicker,
});

type Role = {
  key: string;
  label: string;
  to: string;
  disabled?: boolean;
};

const ROLES: Role[] = [
  { key: "parent", label: "I'm a parent", to: "/signup/parent" },
  { key: "coach", label: "I'm a coach", to: "/signup/coach" },
  { key: "athlete", label: "I'm an athlete", to: "/signup/athlete" },
];

function RolePicker() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Welcome to
          </p>
          <h1 className="mt-3">
            <Logo className="text-7xl" />
          </h1>
          <p className="mt-8 font-display text-3xl leading-tight text-text-primary">
            The operating system for athletic mastery.
          </p>
          <p className="mt-4 text-base text-text-secondary">
            75% of an athlete&apos;s progress happens between lessons. We&apos;re here for that part.
          </p>
        </div>

        <div className="mt-10 space-y-4">
          {ROLES.map((role) => (
            <RoleButton key={role.key} role={role} />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-accent-ink underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

function RoleButton({ role }: { role: Role }) {
  if (role.disabled) {
    return (
      <div
        aria-disabled
        className="flex items-center justify-between rounded-md border border-divider bg-elevated px-6 py-5 text-text-tertiary"
      >
        <span className="font-semibold">{role.label}</span>
        <span className="font-hand text-base">coming soon</span>
      </div>
    );
  }
  return (
    <Link
      to={role.to}
      className="flex items-center justify-between rounded-md bg-accent px-6 py-5 text-accent-foreground shadow-card transition hover:brightness-95"
    >
      <span className="font-semibold">{role.label}</span>
      <ArrowRight className="size-5" aria-hidden />
    </Link>
  );
}

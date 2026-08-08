import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Button } from "@/components/ui/button";

const searchSchema = z.object({
  token: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: zodValidator(searchSchema),
  component: UnsubscribePage,
});

type State =
  | { kind: "loading" }
  | { kind: "valid" }
  | { kind: "already" }
  | { kind: "invalid" }
  | { kind: "success" }
  | { kind: "error"; message: string };

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) setState({ kind: "valid" });
        else if (data.reason === "already_unsubscribed") setState({ kind: "already" });
        else setState({ kind: "invalid" });
      })
      .catch(() => setState({ kind: "invalid" }));
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) setState({ kind: "success" });
      else if (data.reason === "already_unsubscribed") setState({ kind: "already" });
      else setState({ kind: "error", message: data.error ?? "Something went wrong." });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Network error." });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-divider bg-card p-8 space-y-4 shadow-card">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Gradus</p>
        <h1 className="font-display text-h2 text-text-primary">Email preferences</h1>
        {state.kind === "loading" && <p className="text-text-secondary">Checking…</p>}
        {state.kind === "invalid" && (
          <p className="text-text-secondary">This unsubscribe link is invalid or expired.</p>
        )}
        {state.kind === "already" && (
          <p className="text-text-secondary">
            You're already unsubscribed. No further emails will be sent.
          </p>
        )}
        {state.kind === "valid" && (
          <>
            <p className="text-text-secondary">
              Confirm to stop receiving emails from Gradus. Account and security emails will still
              be sent.
            </p>
            <Button onClick={confirm} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}
        {state.kind === "success" && (
          <p className="text-text-secondary">You've been unsubscribed. Sorry to see you go.</p>
        )}
        {state.kind === "error" && (
          <p className="text-pen-pink-ink">Something went wrong: {state.message}</p>
        )}
      </div>
    </div>
  );
}

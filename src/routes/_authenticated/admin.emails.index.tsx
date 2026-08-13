import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { listEmailTemplates } from "@/lib/email-admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";

export const Route = createFileRoute("/_authenticated/admin/emails/")({
  component: AdminEmailsList,
});

function AdminEmailsList() {
  const fetchFn = useServerFn(listEmailTemplates);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-templates"],
    queryFn: () => fetchFn({}),
  });

  const groups = ["Auth", "App", "Internal"] as const;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Email copy</h1>
          <p className="text-text-secondary text-sm mt-1">
            Edit the wording of every email the app sends. Changes go live immediately; anything
            left untouched uses the built-in default.
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : (
        groups.map((group) => {
          const items = (data ?? []).filter((t) => t.category === group);
          if (!items.length) return null;
          return (
            <section key={group} className="space-y-2">
              <p className="text-caption uppercase tracking-widest text-text-tertiary">{group}</p>
              <ul className="space-y-2">
                {items.map((t) => (
                  <li key={t.name}>
                    <Link
                      to="/admin/emails/$name"
                      params={{ name: t.name }}
                      className="press flex items-center gap-3 rounded-lg border border-divider bg-card p-3 shadow-card"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-text-primary truncate">{t.displayName}</p>
                        <p className="text-meta text-text-secondary truncate">{t.description}</p>
                      </div>
                      {t.overrideCount > 0 && (
                        <Tag size="micro" tone="accent">
                          {t.overrideCount} edited
                        </Tag>
                      )}
                      <ArrowRight className="size-4 shrink-0 text-text-tertiary" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

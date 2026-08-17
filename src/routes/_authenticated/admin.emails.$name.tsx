import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  getEmailTemplate,
  getEmailTemplateHistory,
  saveEmailOverride,
  revertEmailOverride,
} from "@/lib/email-admin.functions";
import { previewEmailTemplate } from "@/lib/email-preview.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/emails/$name")({
  component: AdminEmailTemplate,
});

function AdminEmailTemplate() {
  const { name } = Route.useParams();
  const qc = useQueryClient();

  const fetchTemplate = useServerFn(getEmailTemplate);
  const fetchHistory = useServerFn(getEmailTemplateHistory);
  const preview = useServerFn(previewEmailTemplate);
  const save = useServerFn(saveEmailOverride);
  const revert = useServerFn(revertEmailOverride);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-template", name],
    queryFn: () => fetchTemplate({ data: { name } }),
  });

  const { data: history } = useQuery({
    queryKey: ["admin-email-template-history", name],
    queryFn: () => fetchHistory({ data: { name } }),
  });

  // Local draft of every slot value (default or override).
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const slot of data.slots) {
      next[slot.key] = data.overrides[slot.key] ?? data.defaults[slot.key] ?? "";
    }
    setDraft(next);
  }, [data]);

  const roles = PREVIEW_ROLES[name];
  const [role, setRole] = React.useState<string>(roles?.[0]?.value ?? "");
  React.useEffect(() => {
    setRole(PREVIEW_ROLES[name]?.[0]?.value ?? "");
  }, [name]);

  const [html, setHtml] = React.useState("");
  React.useEffect(() => {
    if (!data || !Object.keys(draft).length) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await preview({ data: { name, overrides: draft, role: role || undefined } });
        if (!cancelled) setHtml(res.html);
      } catch {
        /* preview failures are non-fatal */
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, data, name, preview, role]);

  const saveMutation = useMutation({
    mutationFn: (vars: { slotKey: string; value: string }) =>
      save({ data: { templateName: name, slotKey: vars.slotKey, value: vars.value } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin-email-template", name] });
      qc.invalidateQueries({ queryKey: ["admin-email-template-history", name] });
      qc.invalidateQueries({ queryKey: ["admin-email-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const revertMutation = useMutation({
    mutationFn: (slotKey: string) => revert({ data: { templateName: name, slotKey } }),
    onSuccess: () => {
      toast.success("Reverted to default");
      qc.invalidateQueries({ queryKey: ["admin-email-template", name] });
      qc.invalidateQueries({ queryKey: ["admin-email-template-history", name] });
      qc.invalidateQueries({ queryKey: ["admin-email-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not revert"),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin/emails"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
        >
          <ArrowLeft className="size-3.5" /> All emails
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            {data?.category ?? "Email"}
          </Eyebrow>
          <h1 className="font-display text-h2 text-text-primary">
            {data?.displayName ?? "Loading…"}
          </h1>
          <p className="text-text-secondary text-sm mt-1">{data?.description}</p>
        </div>
      </header>

      {isLoading || !data ? (
        <p className="text-text-secondary">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Editor */}
          <div className="space-y-4">
            {data.slots.map((slot) => {
              const value = draft[slot.key] ?? "";
              const defaultValue = data.defaults[slot.key] ?? "";
              const isOverridden = data.overrides[slot.key] !== undefined;
              const dirty = value !== (data.overrides[slot.key] ?? defaultValue);
              return (
                <div
                  key={slot.key}
                  className="rounded-lg border border-divider bg-card p-3 shadow-card space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-caption uppercase tracking-widest text-text-tertiary">
                      {slot.label}
                    </label>
                    <div className="flex items-center gap-2">
                      {isOverridden && (
                        <Tag size="micro" tone="accent">
                          custom
                        </Tag>
                      )}
                      {dirty && (
                        <Tag size="micro" tone="muted">
                          unsaved
                        </Tag>
                      )}
                    </div>
                  </div>

                  {slot.kind === "textarea" ? (
                    <Textarea
                      value={value}
                      rows={4}
                      onChange={(e) => setDraft((d) => ({ ...d, [slot.key]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [slot.key]: e.target.value }))}
                    />
                  )}

                  {slot.help && <p className="text-meta text-text-secondary">{slot.help}</p>}
                  {slot.variables?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {slot.variables.map((v) => (
                        <Tag key={v} size="nano" tone="muted">
                          {`{${v}}`}
                        </Tag>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={!dirty || saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ slotKey: slot.key, value })}
                    >
                      Save
                    </Button>
                    {isOverridden && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revertMutation.isPending}
                        onClick={() => revertMutation.mutate(slot.key)}
                      >
                        <RotateCcw className="size-3.5" /> Revert
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview + history */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-lg border border-divider bg-card p-2 shadow-card">
              <p className="px-1 pb-2 text-caption uppercase tracking-widest text-text-tertiary">
                Live preview
              </p>
              <iframe
                title="Email preview"
                srcDoc={html}
                className="h-[620px] w-full rounded-md border border-divider bg-white"
              />
            </div>

            {history?.length ? (
              <div className="rounded-lg border border-divider bg-card p-3 shadow-card space-y-2">
                <p className="text-caption uppercase tracking-widest text-text-tertiary">
                  Recent edits
                </p>
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id} className="text-meta text-text-secondary">
                      <span className="font-mono uppercase text-text-tertiary">{h.action}</span>{" "}
                      {h.slot_key} · {new Date(h.changed_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listEmailTemplates,
  getEmailTemplate,
  saveEmailOverride,
  revertEmailOverride,
  getEmailTemplateHistory,
} from "@/lib/email-admin.functions";
import { previewEmailTemplate } from "@/lib/email-preview.functions";

const searchSchema = z.object({
  t: fallback(z.string(), "signup").default("signup"),
});

export const Route = createFileRoute("/_authenticated/admin/emails")({
  validateSearch: zodValidator(searchSchema),
  component: EmailsAdmin,
});

function EmailsAdmin() {
  const { t: selected } = Route.useSearch();

  const listFn = useServerFn(listEmailTemplates);
  const { data: templates } = useQuery({
    queryKey: ["admin-emails-list"],
    queryFn: () => listFn(),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Internal</p>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-h1 text-text-primary">Email copy</h1>
          <Link
            to="/admin"
            search={{ test: false }}
            className="text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary"
          >
            ← Admin
          </Link>
        </div>
        <p className="text-sm text-text-secondary">
          Every email the system sends. Click one to preview it, then edit any copy field. Changes save to the database
          and apply to the next send — no code deploy required.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-4">
          {groupByCategory(templates ?? []).map(([category, items]) => (
            <div key={category} className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-widest text-text-tertiary px-2">{category}</p>
              <ul className="rounded-xl border border-divider bg-card overflow-hidden">
                {items.map((tpl) => (
                  <li key={tpl.name}>
                    <Link
                      from={Route.fullPath}
                      search={{ t: tpl.name }}
                      className={`flex items-center justify-between px-3 py-2 text-sm border-l-4 transition ${
                        selected === tpl.name
                          ? "border-accent bg-elevated text-text-primary"
                          : "border-transparent text-text-secondary hover:bg-elevated"
                      }`}
                    >
                      <span className="truncate">{tpl.displayName}</span>
                      {tpl.overrideCount > 0 && (
                        <span
                          className="ml-2 shrink-0 h-2 w-2 rounded-full bg-accent"
                          title={`${tpl.overrideCount} custom slot(s)`}
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <TemplateEditor key={selected} name={selected} />
      </div>
    </div>
  );
}

function groupByCategory(list: Array<{ name: string; displayName: string; category: string; overrideCount: number }>) {
  const groups = new Map<string, typeof list>();
  for (const item of list) {
    const arr = groups.get(item.category) ?? [];
    arr.push(item);
    groups.set(item.category, arr);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function TemplateEditor({ name }: { name: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getEmailTemplate);
  const saveFn = useServerFn(saveEmailOverride);
  const revertFn = useServerFn(revertEmailOverride);
  const previewFn = useServerFn(previewEmailTemplate);
  const historyFn = useServerFn(getEmailTemplateHistory);

  const { data: template, isLoading } = useQuery({
    queryKey: ["admin-email", name],
    queryFn: () => getFn({ data: { name } }),
  });

  // Local edit state
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (template) {
      setValues({ ...template.defaults, ...template.overrides });
    }
  }, [template]);

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const previewMutation = useMutation({
    mutationFn: () => previewFn({ data: { name, overrides: values } }),
    onSuccess: ({ html }) => setPreviewHtml(html),
  });

  // Debounce preview refresh on edits
  useEffect(() => {
    if (!template) return;
    const t = setTimeout(() => previewMutation.mutate(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, template]);

  const dirtySlots = useMemo(() => {
    if (!template) return new Set<string>();
    const s = new Set<string>();
    for (const slot of template.slots) {
      const current = values[slot.key] ?? "";
      const saved = template.overrides[slot.key] ?? template.defaults[slot.key] ?? "";
      if (current !== saved) s.add(slot.key);
    }
    return s;
  }, [template, values]);

  const overriddenSlots = useMemo(() => {
    if (!template) return new Set<string>();
    return new Set(Object.keys(template.overrides));
  }, [template]);

  const saveSlot = async (slotKey: string) => {
    await saveFn({ data: { templateName: name, slotKey, value: values[slotKey] ?? "" } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-email", name] }),
      qc.invalidateQueries({ queryKey: ["admin-emails-list"] }),
      qc.invalidateQueries({ queryKey: ["admin-email-history", name] }),
    ]);
  };

  const revertSlot = async (slotKey: string) => {
    await revertFn({ data: { templateName: name, slotKey } });
    setValues((prev) => ({ ...prev, [slotKey]: template?.defaults[slotKey] ?? "" }));
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-email", name] }),
      qc.invalidateQueries({ queryKey: ["admin-emails-list"] }),
      qc.invalidateQueries({ queryKey: ["admin-email-history", name] }),
    ]);
  };

  if (isLoading || !template) {
    return <div className="rounded-xl border border-divider bg-card p-6 text-sm text-text-secondary">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-divider bg-card p-4 space-y-1">
        <h2 className="font-display text-h3 text-text-primary">{template.displayName}</h2>
        <p className="text-sm text-text-secondary">{template.description}</p>
      </section>

      <section className="rounded-xl border border-divider bg-card overflow-hidden">
        <div className="border-b border-divider bg-elevated px-4 py-2 text-xs font-bold uppercase tracking-widest text-text-secondary">
          Live preview
        </div>
        <div className="bg-white">
          <iframe
            title="Email preview"
            className="w-full h-[520px] border-0"
            srcDoc={previewHtml || "<p style='padding:20px;font-family:sans-serif;color:#888'>Rendering…</p>"}
          />
        </div>
      </section>

      <section className="rounded-xl border border-divider bg-card p-4 space-y-4">
        <h3 className="font-display text-h3 text-text-primary">Copy</h3>
        {template.slots.map((slot) => {
          const isOverridden = overriddenSlots.has(slot.key);
          const isDirty = dirtySlots.has(slot.key);
          return (
            <div key={slot.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                  {slot.label}
                  {isOverridden && (
                    <span className="ml-2 text-[10px] font-mono uppercase text-accent-ink">custom</span>
                  )}
                  {isDirty && (
                    <span className="ml-2 text-[10px] font-mono uppercase text-pen-orange-ink">unsaved</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  {isOverridden && (
                    <button
                      type="button"
                      onClick={() => revertSlot(slot.key)}
                      className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-primary"
                    >
                      Revert to default
                    </button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={isDirty ? "default" : "secondary"}
                    disabled={!isDirty}
                    onClick={() => saveSlot(slot.key)}
                  >
                    Save
                  </Button>
                </div>
              </div>
              {slot.kind === "textarea" ? (
                <Textarea
                  value={values[slot.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [slot.key]: e.target.value }))}
                  rows={3}
                  className="font-body text-sm"
                />
              ) : (
                <Input
                  value={values[slot.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [slot.key]: e.target.value }))}
                  className="font-body text-sm"
                />
              )}
              {slot.help && <p className="text-[11px] text-text-tertiary">{slot.help}</p>}
              {slot.variables && slot.variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {slot.variables.map((v) => (
                    <code
                      key={v}
                      className="rounded-md bg-elevated px-1.5 py-0.5 text-[10px] font-mono text-text-secondary"
                    >
                      {"{" + v + "}"}
                    </code>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <HistoryPanel name={name} historyFn={historyFn} />
    </div>
  );
}

function HistoryPanel({ name, historyFn }: { name: string; historyFn: any }) {
  const { data: history } = useQuery({
    queryKey: ["admin-email-history", name],
    queryFn: () => historyFn({ data: { name } }),
  });
  if (!history || history.length === 0) {
    return (
      <section className="rounded-xl border border-divider bg-card p-4">
        <h3 className="font-display text-h3 text-text-primary mb-2">History</h3>
        <p className="text-sm text-text-tertiary">No edits yet.</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-divider bg-card overflow-hidden">
      <div className="border-b border-divider bg-elevated px-4 py-2 text-xs font-bold uppercase tracking-widest text-text-secondary">
        History
      </div>
      <ul className="divide-y divide-divider">
        {history.map((row: any) => (
          <li key={row.id} className="px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-mono text-xs text-text-tertiary">{row.slot_key}</span>{" "}
                  <span className="text-text-secondary">
                    {row.action === "revert" ? "reverted to default" : "updated"}
                  </span>
                </p>
                {row.action !== "revert" && (
                  <p className="truncate text-xs text-text-tertiary italic">"{row.value.slice(0, 120)}"</p>
                )}
              </div>
              <span className="text-xs text-text-tertiary shrink-0">
                {new Date(row.changed_at).toLocaleString()}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

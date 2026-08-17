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
import {
  searchEmailRecipients,
  sendEmailManually,
  previewEmailForRecipient,
  TEST_EMAIL_ADDRESS,
} from "@/lib/email-manual-send.functions";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/emails/$name")({
  component: AdminEmailTemplate,
});

/** Templates whose copy/props change by user type — preview one at a time. */
const PREVIEW_ROLES: Record<string, Array<{ value: string; label: string }>> = {
  welcome: [
    { value: "coach", label: "Coach" },
    { value: "parent", label: "Parent" },
    { value: "athlete", label: "Athlete" },
  ],
  activation: [
    { value: "coach", label: "Coach" },
    { value: "parent", label: "Parent" },
    { value: "athlete", label: "Athlete" },
  ],
  "guardian-activity": [
    { value: "coach", label: "From coach" },
    { value: "athlete", label: "From athlete" },
  ],
};

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
  // When an admin previews "as" a real user, that render wins until the copy
  // or role selection changes again.
  const [personal, setPersonal] = React.useState<{ html: string; label: string } | null>(null);
  React.useEffect(() => {
    if (!data || !Object.keys(draft).length) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await preview({ data: { name, overrides: draft, role: role || undefined } });
        if (!cancelled) {
          setHtml(res.html);
          setPersonal(null);
        }
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
        <div className={data.noPreview ? "max-w-xl" : "grid gap-6 lg:grid-cols-2"}>
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
            {data.noPreview ? null : (
              <div className="rounded-lg border border-divider bg-card p-2 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                  <p className="text-caption uppercase tracking-widest text-text-tertiary">
                    {personal ? `Preview as ${personal.label}` : "Live preview"}
                  </p>
                  {roles?.length ? (
                    <div className="flex items-center gap-1">
                      {roles.map((r) => (
                        <Button
                          key={r.value}
                          size="sm"
                          variant={role === r.value && !personal ? "default" : "outline"}
                          onClick={() => {
                            setPersonal(null);
                            setRole(r.value);
                          }}
                        >
                          {r.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <iframe
                  title="Email preview"
                  srcDoc={personal?.html ?? html}
                  className="h-[620px] w-full rounded-md border border-divider bg-white"
                />
              </div>
            )}

            {data.noPreview ? null : (
              <SendPanel
                name={name}
                role={role || undefined}
                draft={draft}
                onPersonalPreview={setPersonal}
              />
            )}

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

/** Manual push: send this template to a real user, or a test to support. */
function SendPanel({
  name,
  role,
  draft,
  onPersonalPreview,
}: {
  name: string;
  role?: string;
  draft: Record<string, string>;
  onPersonalPreview: (value: { html: string; label: string } | null) => void;
}) {
  const search = useServerFn(searchEmailRecipients);
  const send = useServerFn(sendEmailManually);
  const previewAs = useServerFn(previewEmailForRecipient);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Array<{ id: string; email: string }>>([]);
  const [selected, setSelected] = React.useState<string>("");

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await search({ data: { query: query.trim() } });
        if (!cancelled) setResults(res);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  const sendMutation = useMutation({
    mutationFn: (recipientEmail: string) => send({ data: { name, recipientEmail, role } }),
    onSuccess: (res: any) =>
      toast.success(
        res?.firstName
          ? `Queued to ${res.recipient} — personalized for ${res.firstName}`
          : `Queued to ${res?.recipient ?? "recipient"}`,
      ),
    onError: (e: any) => toast.error(e?.message ?? "Could not send"),
  });

  const previewMutation = useMutation({
    mutationFn: (recipientEmail: string) =>
      previewAs({ data: { name, recipientEmail, overrides: draft } }),
    onSuccess: (res: any) => {
      onPersonalPreview({
        html: res.html,
        label: res.firstName ? `${res.firstName} (${res.email ?? selected})` : selected,
      });
      if (!res.found) toast.message("No app profile for that address — showing sample data");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not preview"),
  });

  return (
    <div className="rounded-lg border border-divider bg-card p-3 shadow-card space-y-3">
      <p className="text-caption uppercase tracking-widest text-text-tertiary">Send this email</p>

      <div className="space-y-2">
        <Input
          value={query}
          placeholder="Search users by email…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
          }}
        />
        {results.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded-md border border-divider divide-y divide-divider">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`w-full px-2 py-1.5 text-left text-meta press-soft ${
                    selected === r.email ? "bg-elevated text-text-primary" : "text-text-secondary"
                  }`}
                  onClick={() => {
                    setSelected(r.email);
                    setQuery(r.email);
                  }}
                >
                  {r.email}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!selected || sendMutation.isPending}
          onClick={() => sendMutation.mutate(selected)}
        >
          Send to {selected || "selected user"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || previewMutation.isPending}
          onClick={() => previewMutation.mutate(selected)}
        >
          Preview as this user
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sendMutation.isPending}
          onClick={() => sendMutation.mutate(TEST_EMAIL_ADDRESS)}
        >
          Send test to {TEST_EMAIL_ADDRESS}
        </Button>
      </div>

      <p className="text-meta text-text-secondary">
        Real sends use the recipient&apos;s own name and role from their profile
        {role ? `; the ${role} toggle only affects the sample preview` : ""}. Sends the saved copy
        (not unsaved edits) through the normal email queue, so suppressed addresses are respected.
      </p>
    </div>
  );
}

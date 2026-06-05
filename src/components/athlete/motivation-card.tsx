import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

export function MotivationCard({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(
        taRef.current.value.length,
        taRef.current.value.length,
      );
    }
  }, [editing]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    try {
      setSaving(true);
      await onSave(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-2xl border border-divider bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          What motivates you?
        </p>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-text-secondary hover:bg-muted hover:text-text-primary"
            aria-label="Edit motivation"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="What gets you to practice on the hard days?"
            className="w-full resize-none rounded-xl border border-divider bg-card px-3 py-2 font-hand text-lg leading-snug text-text-primary outline-none focus:border-primary"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
              disabled={saving}
              className="rounded-full px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : value.trim().length > 0 ? (
        <p className="mt-2 font-hand text-lg leading-snug text-text-primary">
          “{value}”
        </p>
      ) : (
        <p className="mt-2 font-hand text-lg leading-snug text-text-secondary">
          Tap edit to share what drives you…
        </p>
      )}
    </article>
  );
}

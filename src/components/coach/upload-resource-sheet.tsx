import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { supabase } from "@/integrations/supabase/client";
import { getSport, type SportKey } from "@/lib/coach-sports";
import {
  createCoachResource,
  createCoachResourceUploadUrl,
  type CoachResourceKind,
} from "@/lib/coach-resources.functions";

function sportLabel(s: string) {
  return getSport(s as SportKey)?.label ?? s;
}

const ACCEPT: Record<Exclude<CoachResourceKind, "link">, string> = {
  pdf: "application/pdf",
  image: "image/*",
};

export function UploadResourceSheet({
  open,
  onOpenChange,
  coachSports,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  coachSports: string[];
}) {
  const qc = useQueryClient();
  const signUpload = useServerFn(createCoachResourceUploadUrl);
  const createFn = useServerFn(createCoachResource);

  const [kind, setKind] = useState<CoachResourceKind>("pdf");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sports, setSports] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setKind("pdf");
    setTitle("");
    setDescription("");
    setUrl("");
    setFile(null);
    setSports([]);
    setErr(null);
  }

  const create = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (!title.trim()) throw new Error("Add a title");
      if (!sports.length) throw new Error("Tag at least one sport");

      if (kind === "link") {
        await createFn({
          data: {
            title: title.trim(),
            description: description.trim(),
            kind,
            sports,
            externalUrl: url.trim(),
          },
        });
        return;
      }

      if (!file) throw new Error("Choose a file");
      const ext =
        (file.name.split(".").pop() ?? "").toLowerCase() || (kind === "pdf" ? "pdf" : "png");
      const signed = await signUpload({
        data: { ext, contentType: file.type || ACCEPT[kind] },
      });
      const { error: upErr } = await supabase.storage
        .from("resource-pdfs")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type || ACCEPT[kind],
        });
      if (upErr) throw upErr;
      await createFn({
        data: {
          title: title.trim(),
          description: description.trim(),
          kind,
          sports,
          storagePath: signed.path,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach-resources"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent
        side="bottom"
        className="paper-surface h-[92dvh] rounded-t-3xl border-divider p-0"
      >
        <SheetHeader className="flex-row items-center justify-between px-5 pt-5 pb-3">
          <SheetTitle className="text-lg">Add a resource</SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="rounded-full"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </SheetHeader>
        <div className="h-[calc(92dvh-72px)] space-y-5 overflow-y-auto border-t border-divider bg-card px-5 py-5">
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
              Type
            </label>
            <div className="mt-2">
              <SegmentedToggle
                value={kind}
                onChange={(v) => setKind(v as CoachResourceKind)}
                options={[
                  { key: "pdf", label: "PDF" },
                  { key: "image", label: "Image" },
                  { key: "link", label: "Link" },
                ]}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Serve technique breakdown"
              className="h-11 rounded-2xl"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this for?"
              className="min-h-20 rounded-2xl"
            />
          </div>

          {kind === "link" ? (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
                URL (https)
              </label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="h-11 rounded-2xl"
                inputMode="url"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
                File
              </label>
              <input
                type="file"
                accept={ACCEPT[kind]}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-2xl border border-divider bg-elevated p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-accent-foreground"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-text-secondary">
              Sports (tag one or more)
            </label>
            {coachSports.length === 0 ? (
              <p className="text-sm text-text-secondary">Add sports in Settings first.</p>
            ) : (
              <ul className="divide-y divide-divider rounded-2xl border border-divider bg-elevated">
                {coachSports.map((s) => {
                  const on = sports.includes(s);
                  return (
                    <li key={s}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm">
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) =>
                            setSports((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))
                          }
                        />
                        <span className="font-bold text-text-primary">{sportLabel(s)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {err ? (
            <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err}
            </p>
          ) : null}

          <div className="pt-2">
            <Button
              type="button"
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-full"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Uploading…
                </>
              ) : (
                "Publish to your roster"
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Palette, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterPill } from "@/components/ui/filter-pill";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getClubPdfBranding, saveClubPdfBranding } from "@/lib/resource-builder.functions";
import { DEFAULT_BRANDING, type BrandFont, type PdfBranding } from "@/lib/resource-builder";

const FONT_OPTIONS = [
  { value: "sans", label: "Clean sans (Helvetica)" },
  { value: "serif", label: "Classic serif (Times)" },
  { value: "mono", label: "Typewriter (Courier)" },
];

type Logo = { base64: string; type: "image/png" | "image/jpeg" } | null | undefined;

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`${label} picker`}
          className="h-11 w-14 shrink-0 cursor-pointer p-1"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <Input id={id} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      </div>
    </div>
  );
}

/** Club PDF branding: colors, logo, header/footer text and fonts used by the resource builder. */
export function PdfBrandingSheet({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const getFn = useServerFn(getClubPdfBranding);
  const saveFn = useServerFn(saveClubPdfBranding);
  const q = useQuery({
    queryKey: ["org-pdf-branding", orgId],
    queryFn: () => getFn({ data: { organizationId: orgId } }),
  });
  const [form, setForm] = useState<PdfBranding>(DEFAULT_BRANDING);
  const [logo, setLogo] = useState<Logo>(undefined);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && q.data) {
      setForm(q.data.branding);
      setLogo(undefined);
      setLogoPreview(q.data.logoPreview);
    }
  }, [open, q.data]);

  const set = (p: Partial<PdfBranding>) => setForm((f) => ({ ...f, ...p }));
  const valid = [form.primaryColor, form.secondaryColor].every((c) => /^#[0-9a-f]{6}$/i.test(c));

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return toast.error("Use a PNG or JPG logo.");
    if (file.size > 1_500_000) return toast.error("Logos must be under 1.5 MB.");
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      setLogoPreview(url);
      setLogo({ base64: url.split(",")[1] ?? "", type: file.type as "image/png" | "image/jpeg" });
    };
    r.readAsDataURL(file);
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          organizationId: orgId,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          headingFont: form.headingFont,
          bodyFont: form.bodyFont,
          headerText: form.headerText,
          footerText: form.footerText,
          logo,
        },
      }),
    onSuccess: () => {
      toast.success("Branding saved. New PDFs will use it.");
      qc.invalidateQueries({ queryKey: ["org-pdf-branding", orgId] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save branding"),
  });

  return (
    <>
      <Button variant="outline" className="press" onClick={() => setOpen(true)}>
        <Palette className="size-4" /> PDF branding
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-popover sm:max-w-md">
          <SheetHeader>
            <SheetTitle>PDF branding</SheetTitle>
            <SheetDescription>Every PDF you make here uses these. Saved for your whole club.</SheetDescription>
          </SheetHeader>
          {q.isPending ? (
            <Loader2 className="m-4 size-5 animate-spin text-text-tertiary" />
          ) : (
            <div className="space-y-5 px-4 pb-4">
              <div className="space-y-1.5">
                <Label>Logo</Label>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-28 items-center justify-center rounded-sm border border-divider bg-card">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Club logo" className="max-h-14 max-w-24 object-contain" />
                    ) : (
                      <span className="text-meta text-text-tertiary">No logo</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button variant="outline" size="sm" className="press" onClick={() => fileRef.current?.click()}>
                      <Upload className="size-4" /> Upload
                    </Button>
                    {logoPreview && (
                      <Button variant="ghost" size="sm" className="press" onClick={() => { setLogo(null); setLogoPreview(null); }}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
                    onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                <p className="text-meta text-text-tertiary">PNG or JPG, under 1.5 MB. Without one, your club profile logo is used.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField id="pb-primary" label="Primary color" value={form.primaryColor} onChange={(v) => set({ primaryColor: v })} />
                <ColorField id="pb-secondary" label="Secondary color" value={form.secondaryColor} onChange={(v) => set({ secondaryColor: v })} />
              </div>
              <p className="-mt-3 text-meta text-text-tertiary">Primary draws the rule under the header. Secondary colors headings, the header and the footer.</p>
              <div className="space-y-1.5">
                <Label htmlFor="pb-header">Header text</Label>
                <Input id="pb-header" maxLength={120} value={form.headerText} placeholder={q.data?.clubName}
                  onChange={(e) => set({ headerText: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pb-footer">Footer text</Label>
                <Input id="pb-footer" maxLength={200} value={form.footerText} placeholder={q.data?.clubName}
                  onChange={(e) => set({ footerText: e.target.value })} />
                <p className="text-meta text-text-tertiary">Page numbers are added after it.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Heading font</Label>
                <FilterPill aria-label="Heading font" className="w-full" value={form.headingFont}
                  onValueChange={(v) => set({ headingFont: v as BrandFont })} options={FONT_OPTIONS} />
              </div>
              <div className="space-y-1.5">
                <Label>Body font</Label>
                <FilterPill aria-label="Body font" className="w-full" value={form.bodyFont}
                  onValueChange={(v) => set({ bodyFont: v as BrandFont })} options={FONT_OPTIONS} />
                <p className="text-meta text-text-tertiary">PDFs use standard print fonts so they open the same everywhere.</p>
              </div>
            </div>
          )}
          <SheetFooter className="px-4 pb-4">
            <Button className="press" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save branding
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

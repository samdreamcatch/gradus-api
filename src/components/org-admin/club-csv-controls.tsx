import { useRef } from "react";
import { Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ClubCsvControls({ template, filename, onImport, disabled = false }: {
  template: string;
  filename: string;
  onImport: (text: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="flex flex-wrap gap-2">
    <Button variant="outline" className="min-h-11 press" disabled={disabled} onClick={() => input.current?.click()}><FileUp className="size-4" /> Import CSV</Button>
    <Button variant="outline" className="min-h-11 press" disabled={disabled} onClick={() => {
      const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }}><Download className="size-4" /> Download template</Button>
    <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import CSV file" disabled={disabled} onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try { onImport(await file.text()); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't read this file."); }
    }} />
  </div>;
}
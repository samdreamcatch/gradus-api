import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Play, Download, Trash2, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toCsv, downloadCsv, type CsvValue } from "@/lib/csv";
import { askData, runReadOnlySql, type AskDataResult } from "@/lib/admin-ask.functions";

export const Route = createFileRoute("/_authenticated/admin/ask")({
  component: AskDataPage,
});

const EXAMPLES = [
  "How many minutes of training has each athlete logged in the last 30 days?",
  "Which coaches have assigned plans with no sessions logged?",
  "How many athletes signed up each week this month?",
  "Which parents have never logged a practice session?",
  "Top 10 athletes by number of sessions logged, with their coach",
];

const SAVED_KEY = "gradus.admin.savedQuestions";

function loadSaved(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AskDataPage() {
  const ask = useServerFn(askData);
  const run = useServerFn(runReadOnlySql);

  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<AskDataResult | null>(null);
  const [busy, setBusy] = useState<"ask" | "run" | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  const persist = (next: string[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — shortcuts just won't persist */
    }
  };

  const handleAsk = async (q?: string) => {
    const text = (q ?? question).trim();
    if (text.length < 3) {
      toast.error("Type a question first");
      return;
    }
    if (q) setQuestion(q);
    setBusy("ask");
    try {
      const res = (await ask({ data: { question: text } })) as AskDataResult;
      setResult(res);
      setSql(res.sql);
      if (res.rowCount === 0) toast.info("The query ran but returned no rows");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not answer that");
    } finally {
      setBusy(null);
    }
  };

  const handleRun = async () => {
    if (!sql.trim()) return;
    setBusy("run");
    try {
      const res = (await run({ data: { sql } })) as AskDataResult;
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Query failed");
    } finally {
      setBusy(null);
    }
  };

  const handleExport = () => {
    if (!result || result.rowCount === 0) return;
    const rows: CsvValue[][] = result.rows.map((row) =>
      result.columns.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return "";
        return typeof v === "object" ? JSON.stringify(v) : (v as CsvValue);
      }),
    );
    downloadCsv(`gradus-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(result.columns, rows));
  };

  const saveQuestion = () => {
    const text = question.trim();
    if (!text) return;
    if (saved.includes(text)) return;
    persist([text, ...saved].slice(0, 20));
    toast.success("Saved to your shortcuts");
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Eyebrow size="small" tone="accent-ink">
          Reporting
        </Eyebrow>
        <h1 className="font-display text-h2 text-text-primary">Ask the data</h1>
        <p className="text-meta text-text-secondary mt-1">
          Ask in plain English. Gradus writes a read-only query, runs it, and shows the rows. Nothing
          here can change or delete data.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <Label htmlFor="ask-question">Your question</Label>
        <Textarea
          id="ask-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How many minutes of training has each skater logged this month?"
          rows={3}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handleAsk()} disabled={busy !== null} className="press">
            <Sparkles className="size-4" />
            {busy === "ask" ? "Thinking…" : "Ask"}
          </Button>
          <Button variant="outline" onClick={saveQuestion} disabled={!question.trim()} className="press">
            <Bookmark className="size-4" />
            Save question
          </Button>
        </div>

        <div className="pt-1">
          <p className="text-caption text-text-tertiary mb-2">Try one of these</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Chip key={ex} onClick={() => handleAsk(ex)} className="press">
                {ex}
              </Chip>
            ))}
          </div>
        </div>

        {saved.length > 0 && (
          <div className="pt-1">
            <p className="text-caption text-text-tertiary mb-2">Saved</p>
            <div className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <Chip onClick={() => handleAsk(s)} className="press">
                    {s}
                  </Chip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="press size-7"
                    aria-label="Remove saved question"
                    onClick={() => persist(saved.filter((v) => v !== s))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ask-sql">Query</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRun}
            disabled={busy !== null || !sql.trim()}
            className="press"
          >
            <Play className="size-4" />
            {busy === "run" ? "Running…" : "Run"}
          </Button>
        </div>
        <Textarea
          id="ask-sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="select … — edit the generated query or write your own SELECT"
          rows={6}
          className="font-mono text-mono"
          spellCheck={false}
        />
      </Card>

      {result && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-meta text-text-secondary">
              {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
              {result.truncated ? " (capped at 500)" : ""}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={result.rowCount === 0}
              className="press"
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>

          {result.rowCount === 0 ? (
            <p className="text-meta text-text-tertiary">No rows matched.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((c) => (
                        <TableCell key={c} className="whitespace-nowrap">
                          {cellText(row[c])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

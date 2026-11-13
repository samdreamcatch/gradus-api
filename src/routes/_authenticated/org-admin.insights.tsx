import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubTable } from "@/components/org-admin/club-table";
import { useOrgId } from "@/components/org-admin/org-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INSIGHT_QUESTIONS, type InsightCell, type InsightColumn, type InsightId, type InsightResult } from "@/lib/club-insights";
import { matchClubInsight, runClubInsight } from "@/lib/club-insights.functions";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/org-admin/insights")({
  head: () => ({
    meta: [
      { title: "Insights · Gradus Club" },
      { name: "description", content: "Ask questions about your club's lessons, practice and coaches." },
      { property: "og:title", content: "Insights · Gradus Club" },
      { property: "og:description", content: "Ask questions about your club's lessons, practice and coaches." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InsightsPage,
});

function formatCell(value: InsightCell, kind: InsightColumn["kind"]) {
  if (value === null || value === "") return "—";
  if (kind === "percent") return `${value}%`;
  if (kind === "number" && typeof value === "number") return value.toLocaleString();
  return String(value);
}

function InsightsPage() {
  const { orgId } = useOrgId();
  const runFn = useServerFn(runClubInsight);
  const matchFn = useServerFn(matchClubInsight);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (questionId: InsightId) => {
      if (!orgId) throw new Error("No club selected");
      return runFn({ data: { organizationId: orgId, questionId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't run that question."),
  });
  const ask = useMutation({
    mutationFn: (text: string) => {
      if (!orgId) throw new Error("No club selected");
      return matchFn({ data: { organizationId: orgId, question: text } });
    },
    onSuccess: (m) => {
      setReply(m.reply);
      if (m.questionId) run.mutate(m.questionId);
      else run.reset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't read that question."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 3) ask.mutate(question.trim());
  };
  const result: InsightResult | undefined = run.data;
  const busy = ask.isPending || run.isPending;

  const exportCsv = () => {
    if (!result) return;
    downloadCsv(
      `${result.id}.csv`,
      toCsv(result.columns.map((c) => c.label), result.rows.map((r) => result.columns.map((c) => r[c.key] ?? ""))),
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <ClubPageHeader title="Insights" />

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your club, e.g. which students are stuck?"
          aria-label="Ask a question"
          maxLength={500}
          className="h-11 flex-1"
        />
        <Button type="submit" className="press h-11 rounded-md" disabled={busy || question.trim().length < 3}>
          {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Ask
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {INSIGHT_QUESTIONS.map((q) => (
          <Button
            key={q.id}
            type="button"
            variant="outline"
            className="press h-auto min-h-11 max-w-full whitespace-normal rounded-md text-left"
            disabled={busy}
            onClick={() => { setReply(null); setQuestion(q.prompt); run.mutate(q.id); }}
          >
            {q.prompt}
          </Button>
        ))}
      </div>

      {reply && <p className="font-sans text-sm text-text-secondary">{reply}</p>}

      {run.isPending && (
        <div className="flex items-center gap-2 text-text-secondary"><Loader2 className="size-4 animate-spin" /> Crunching your club's numbers…</div>
      )}

      {result && !run.isPending && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-display text-h3 text-text-primary">{result.title}</h2>
              <p className="max-w-3xl font-sans text-sm text-text-secondary">{result.note}</p>
            </div>
            <Button variant="outline" className="press h-11 rounded-md" onClick={exportCsv} disabled={!result.rows.length}>
              <Download className="size-4" /> CSV
            </Button>
          </div>
          {result.rows.length ? (
            <ClubTable>
              <TableHeader>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableHead key={c.key} className={c.kind === "number" || c.kind === "percent" ? "text-right" : ""}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((r, i) => (
                  <TableRow key={i}>
                    {result.columns.map((c) => (
                      <TableCell key={c.key} className={c.kind === "number" || c.kind === "percent" ? "text-right tabular-nums" : ""}>
                        {formatCell(r[c.key] ?? null, c.kind)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </ClubTable>
          ) : (
            <p className="rounded-md border border-dashed border-divider bg-card px-4 py-8 text-center text-text-secondary">
              No matching results yet.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

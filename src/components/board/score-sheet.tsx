import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Separator } from "@/components/ui/separator";
import { Tag } from "@/components/ui/tag";
import type { SkaterProtocol } from "@/lib/board-types";
import type { ScoreSelection, Skate } from "@/lib/board-skaters";

/** The judged detail behind one posted score. */
function ProtocolDetail({ p }: { p: SkaterProtocol }) {
  return (
    <div className="space-y-5">
      <ScoreCells
        cells={[
          ["SCORE", p.total],
          ["ELEMENTS", p.elementsScore],
          ["COMPONENTS", p.componentsScore],
          ["DEDUCT.", p.deductionsScore],
        ]}
      />

      {p.elements.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow size="micro" tone="tertiary" as="h3">
            EXECUTED ELEMENTS
          </Eyebrow>
          <div
            aria-hidden="true"
            className="flex items-baseline gap-2 font-mono text-nano uppercase tracking-wider text-text-tertiary"
          >
            <span className="w-5 shrink-0" />
            <span className="min-w-0 flex-1">Element</span>
            <span className="w-12 shrink-0 text-right">Base</span>
            <span className="w-12 shrink-0 text-right">GOE</span>
            <span className="w-12 shrink-0 text-right">Score</span>
          </div>
          <div className="space-y-1">
            {p.elements.map((el, i) => (
              <div
                key={`${el.executed}-${i}`}
                aria-label={`${el.executed || el.planned}: base value ${el.baseValue}, GOE ${el.goe}, score ${el.score}`}
                className="flex items-baseline gap-2 font-mono text-xs tabular-nums"
              >
                <span className="w-5 shrink-0 text-text-tertiary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {el.executed || el.planned}
                </span>
                <span className="w-12 shrink-0 text-right text-text-tertiary">{el.baseValue}</span>
                <span className="w-12 shrink-0 text-right text-text-secondary">{el.goe}</span>
                <span className="w-12 shrink-0 text-right text-text-primary">{el.score}</span>
              </div>
            ))}
            {p.elementsTotal ? (
              <>
                <Separator className="my-1" />
                <div
                  aria-label={`Totals: base value ${p.elementsTotal.baseValue}, score ${p.elementsTotal.score}`}
                  className="flex items-baseline gap-2 font-mono text-xs tabular-nums"
                >
                  <span className="min-w-0 flex-1 text-text-secondary">Totals</span>
                  <span className="w-12 shrink-0 text-right text-text-tertiary">
                    {p.elementsTotal.baseValue}
                  </span>
                  <span className="w-12 shrink-0" />
                  <span className="w-12 shrink-0 text-right text-text-primary">
                    {p.elementsTotal.score}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {p.components.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow size="micro" tone="tertiary" as="h3">
            PROGRAM COMPONENTS
          </Eyebrow>
          {p.components.map((c) => (
            <div
              key={c.name}
              aria-label={`${c.name}: ${c.unfactored}, factor ${c.factor}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-text-primary">{c.name}</span>
              <span className="font-mono text-xs text-text-secondary tabular-nums">
                {c.unfactored}
              </span>
              <span className="w-14 text-right font-mono text-xs text-text-tertiary tabular-nums">
                ×{c.factor}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {p.deductions.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow size="micro" tone="tertiary" as="h3">
            DEDUCTIONS
          </Eyebrow>
          {p.deductions.map((d) => (
            <div key={d.name} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-text-primary">{d.name}</span>
              <span className="font-mono text-xs text-text-secondary tabular-nums">−{d.value}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ScoreCells({ cells }: { cells: [string, string][] }) {
  return (
    <div
      className="grid gap-2 text-center"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-divider bg-elevated px-2 py-3">
          <Eyebrow size="nano" tone="tertiary" className="block">
            {label}
          </Eyebrow>
          <span className="mt-1 block font-mono text-base text-text-primary tabular-nums">
            {value || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** Event, status and where/when, above every skate. */
function SkateHeader({ skate }: { skate: Skate }) {
  const { event, skater } = skate;
  const of = skater.of || event.count || 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-text-primary">
          {[event.name, event.segment].filter(Boolean).join(" · ") || "Event"}
        </h3>
        <Tag size="nano" tone={event.status === "live" ? "accent" : "default"}>
          {event.status === "final"
            ? "FINAL"
            : event.status === "live"
              ? "IN PROGRESS"
              : "SCHEDULED"}
        </Tag>
      </div>
      <p className="font-mono text-xs text-text-tertiary">
        {[
          event.rink,
          [event.dayLabel, event.timeLabel].filter(Boolean).join(" "),
          of ? `skates ${ordinal(skater.start)} of ${of}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

/** A posted score whose judged detail the board doesn't carry. */
function ScoreOnly({ skate }: { skate: Skate }) {
  const s = skate.skater;
  const place = (s.finalPlace || s.place || "").trim();
  const cells = (
    [
      ["SCORE", s.segScore],
      ["TOTAL", s.total === s.segScore ? "" : s.total],
      ["PLACE", place],
    ] as [string, string][]
  ).filter(([, v]) => v);
  return (
    <div className="space-y-2">
      <ScoreCells cells={cells} />
      <p className="text-sm text-text-secondary">
        The element-by-element protocol isn&apos;t included for this skate.
      </p>
      {skate.officialUrl ? (
        <a
          href={skate.officialUrl}
          target="_blank"
          rel="noreferrer"
          className="press-soft inline-flex min-h-11 items-center text-sm font-bold text-accent-ink underline underline-offset-4"
        >
          Official results ↗
        </a>
      ) : null}
    </div>
  );
}

function Pending({ skate }: { skate: Skate }) {
  const { event } = skate;
  const [title, line] =
    event.status === "final"
      ? ["NO SCORE POSTED", "No score was posted for this skate."]
      : event.status === "live"
        ? ["RESULTS PENDING", "Scores post a minute or two after each skate and show up here."]
        : [
            "NOT SKATED YET",
            event.timeLabel
              ? `Scheduled for ${event.timeLabel}. Scores show up here as soon as they post.`
              : "Scores show up here as soon as they post.",
          ];
  return (
    <div className="rounded-xl border border-divider bg-elevated px-4 py-3">
      <Eyebrow size="nano" tone="tertiary" className="block">
        {title}
      </Eyebrow>
      <p className="mt-1 text-sm text-text-secondary">{line}</p>
    </div>
  );
}

/**
 * A skater's scores at this competition, the one presentation every board
 * surface opens (the wheel and lanes, My skaters, the follow search, event
 * results): every skate they have, the one tapped first. A protocol shows
 * exactly as the officials filed it, from the same published event page the
 * board already reads; a score without one shows what posted and links the
 * official page; a skate still to come says when.
 */
export function ScoreSheet({
  selection,
  onOpenChange,
}: {
  selection: ScoreSelection | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!selection} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-h3 text-text-primary">
            {selection?.name ?? ""}
          </SheetTitle>
          {selection?.club ? (
            <p className="font-mono text-xs text-text-tertiary">{selection.club}</p>
          ) : null}
        </SheetHeader>

        <div className="space-y-5 pb-6">
          {selection && selection.skates.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing has posted for this skater yet.</p>
          ) : null}
          {selection?.skates.map((skate, i) => (
            <section key={`${skate.event.file}-${skate.skater.start}`} className="space-y-3">
              {i > 0 ? <Separator /> : null}
              <SkateHeader skate={skate} />
              {skate.skater.protocol ? (
                <ProtocolDetail p={skate.skater.protocol} />
              ) : skate.skater.segScore ? (
                <ScoreOnly skate={skate} />
              ) : (
                <Pending skate={skate} />
              )}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

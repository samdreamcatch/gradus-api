import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Separator } from "@/components/ui/separator";
import type { BoardSkater, SkaterProtocol } from "@/lib/board-types";

/** One skate: an event plus the skater's row in it, scored or not yet. */
export interface ScoreEntry {
  skater: BoardSkater;
  eventLabel: string;
  /** Scheduled time, shown while results are still pending. */
  pendingLabel?: string;
}

/** The judged detail behind one posted score. */
function ProtocolDetail({ p }: { p: SkaterProtocol }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ["SCORE", p.total],
          ["ELEMENTS", p.elementsScore],
          ["COMPONENTS", p.componentsScore],
          ["DEDUCT.", p.deductionsScore],
        ].map(([label, value]) => (
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

/**
 * The judged protocol behind a posted score, exactly as the officials filed it.
 * Everything shown here comes from the same published event page the board
 * already reads — no extra request, no interpretation.
 *
 * Pass `entries` to show every skate this athlete has on the day; events with
 * no posted result yet read as pending rather than being hidden.
 */
export function ScoreSheet({
  skater,
  eventLabel,
  entries,
  onOpenChange,
}: {
  skater: BoardSkater | null;
  eventLabel: string;
  entries?: ScoreEntry[];
  onOpenChange: (open: boolean) => void;
}) {
  const list: ScoreEntry[] =
    entries && entries.length > 0 ? entries : skater ? [{ skater, eventLabel }] : [];
  const multiple = list.length > 1;

  return (
    <Sheet open={!!skater} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-h3 text-text-primary">
            {skater?.name ?? ""}
          </SheetTitle>
          <p className="font-mono text-xs text-text-tertiary">
            {[multiple ? "" : list[0]?.eventLabel, skater?.club].filter(Boolean).join(" · ")}
          </p>
        </SheetHeader>

        <div className="space-y-5 pb-6">
          {list.map((entry, i) => {
            const p = entry.skater.protocol ?? null;
            return (
              <section key={`${entry.eventLabel}-${entry.skater.start}-${i}`} className="space-y-3">
                {multiple ? (
                  <>
                    {i > 0 ? <Separator /> : null}
                    <Eyebrow size="micro" tone="tertiary" as="h3">
                      {entry.eventLabel || "EVENT"}
                    </Eyebrow>
                  </>
                ) : null}

                {p ? (
                  <ProtocolDetail p={p} />
                ) : (
                  <div className="rounded-xl border border-divider bg-elevated px-4 py-3">
                    <Eyebrow size="nano" tone="tertiary" className="block">
                      RESULTS PENDING
                    </Eyebrow>
                    <p className="mt-1 text-sm text-text-secondary">
                      {entry.skater.segScore
                        ? `Scored ${entry.skater.segScore} — judged detail hasn't been published yet.`
                        : entry.pendingLabel
                          ? `Scheduled for ${entry.pendingLabel}. Scores show up here as soon as they post.`
                          : "Scores show up here as soon as they post."}
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { ChevronDown, Flag, Globe, Mail, MessageSquare, Phone } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  GRADUS_SUPPORT_EMAIL,
  HOTLINES,
  REPORT_TO_GRADUS,
  formatTel,
  type Hotline,
} from "@/lib/safe-sport-content";

const COUNTS_ITEMS = [
  "Someone yells, mocks, or names-calls — at you or someone else.",
  "Comments about your body, weight, or what you eat that feel off.",
  "Pressure to train hurt, hide an injury, or push through pain.",
  "Texts, DMs, or photos from an adult or another athlete in your sport that feel too personal.",
  "Touching that wasn't needed for the move, or that you didn't want.",
  "Being alone with an adult or another athlete in ways that feel uncomfortable.",
  "Anything that makes you feel scared, small, or like you can't say no.",
];

export function SafeSportPanel() {
  return (
    <section className="mt-5 space-y-6">
      {/* More from SafeSport */}
      <a
        href="https://uscenterforsafesport.org/about/faqs/"
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-2xl border border-divider bg-card p-4 transition-colors hover:bg-card/60"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
            <Globe className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">More from SafeSport</p>
            <p className="mt-1 text-xs text-text-secondary">
              Training videos, athlete toolkits, and resources from the U.S. Center for SafeSport.
            </p>
          </div>
        </div>
      </a>

      <CountsDisclosure />
      <TrustedAdultDisclosure />
      <ReportToGradus />

      {/* Hotlines */}
      <div>
        <h3 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
          Talk to someone now
        </h3>
        <ul className="space-y-2">
          {HOTLINES.map((h) => (
            <li key={h.name}>
              <HotlineCard hotline={h} />
            </li>
          ))}
        </ul>
        <p className="mt-3 px-1 text-xs text-text-tertiary">
          These are independent services — not Gradus, and not your coach. What you share with them
          stays with them.
        </p>
      </div>

      <p className="px-1 text-xs text-text-tertiary">
        If you or someone else is in immediate danger, call 911.
      </p>
    </section>
  );
}

/** Reporting to Gradus itself (PRD §6.13 C, Guideline 1.2): the contact and the response commitment. */
export function ReportToGradus() {
  return (
    <div className="rounded-2xl border border-divider bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
          <Flag className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium text-text-primary">{REPORT_TO_GRADUS.title}</h3>
          <p className="text-sm text-text-secondary">{REPORT_TO_GRADUS.body}</p>
          <p className="text-sm text-text-secondary">{REPORT_TO_GRADUS.commitment}</p>
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={`mailto:${GRADUS_SUPPORT_EMAIL}`}>
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {GRADUS_SUPPORT_EMAIL}
            </a>
          </Button>
          <p className="text-xs text-text-tertiary">{REPORT_TO_GRADUS.notEmergency}</p>
        </div>
      </div>
    </div>
  );
}

function HotlineCard({ hotline }: { hotline: Hotline }) {
  return (
    <div className="rounded-2xl border border-divider bg-card p-4">
      <p className="text-sm font-medium text-text-primary">{hotline.name}</p>
      <p className="mt-1 text-xs text-text-tertiary">{hotline.hours}</p>
      <p className="mt-2 text-sm text-text-secondary">{hotline.blurb}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {hotline.tel && (
          <Button asChild size="sm" className="rounded-full">
            <a href={`tel:${hotline.tel}`}>
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call {formatTel(hotline.tel)}
            </a>
          </Button>
        )}
        {hotline.sms && (
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={`sms:${hotline.sms}`}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Text {hotline.sms}
            </a>
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <a href={hotline.url} target="_blank" rel="noopener noreferrer">
            <Globe className="h-3.5 w-3.5" aria-hidden />
            Website
          </a>
        </Button>
      </div>
    </div>
  );
}

function CountsDisclosure() {
  return (
    <Collapsible className="border-t border-divider pt-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-text-primary">Not sure if it "counts"?</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-sm text-text-secondary">
          If any of these are happening, it's worth talking to someone. You don't have to decide
          what it is — that's their job.
        </p>
        <ul className="space-y-2">
          {COUNTS_ITEMS.map((t) => (
            <li
              key={t}
              className="flex gap-2 rounded-xl border border-divider bg-card px-3 py-2 text-sm text-text-secondary"
            >
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TrustedAdultDisclosure() {
  return (
    <Collapsible className="border-t border-divider pt-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-text-primary">
          Want to tell an adult you trust?
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-sm text-text-secondary">
          That could be a parent, another coach, a teacher, a doctor, or an older sibling. You don't
          have to have the right words. Try something like:
        </p>
        <div className="rounded-2xl border border-divider bg-card p-4">
          <p className="text-sm italic text-text-secondary">
            "Something's been bugging me about practice and I don't really know how to explain it.
            Can we talk for a few minutes?"
          </p>
        </div>
        <p className="text-xs text-text-tertiary">
          If the first adult doesn't get it, try another one. That's not on you.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

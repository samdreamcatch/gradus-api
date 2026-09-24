/**
 * The Safe Sport panel's hotlines (PRD §7.9): one list for the web panel
 * (`src/components/resources/safe-sport-panel.tsx`) and for Ask Gradus,
 * which puts the same hotlines above any answer to a safety question
 * (PRD §6.7 "Grounded Ask Gradus" item 5). iOS carries its own native copy
 * in `SafeSportView`; keep both in step.
 */
export type Hotline = {
  name: string;
  blurb: string;
  tel?: string;
  sms?: string;
  url: string;
  hours: string;
};

export const HOTLINES: Hotline[] = [
  {
    name: "U.S. Center for SafeSport",
    blurb:
      "Specifically for sport. You can report something about a coach, teammate, or official — or just ask if something counts.",
    tel: "8663676272",
    url: "https://uscenterforsafesport.org/report-a-concern/",
    hours: "Online 24/7 · Phone Mon–Fri",
  },
  {
    name: "Childhelp National Hotline",
    blurb:
      "Trained counselors for anyone under 18 (or worried about someone under 18). Free, confidential, you don't have to give your name.",
    tel: "18004224453",
    url: "https://www.childhelphotline.org/",
    hours: "Call or text · 24/7",
  },
  {
    name: "Crisis Text Line",
    blurb:
      "If talking out loud feels like too much, text a trained counselor instead. They'll text back.",
    sms: "741741",
    url: "https://www.crisistextline.org/",
    hours: "Text HOME to 741741 · 24/7",
  },
  {
    name: "988 Suicide & Crisis Lifeline",
    blurb:
      "If you're in crisis — about anything, not only sport — call or text 988. You don't have to be in danger to use it.",
    tel: "988",
    sms: "988",
    url: "https://988lifeline.org/",
    hours: "Call or text · 24/7",
  },
];

export function formatTel(digits: string): string {
  if (digits.length === 11 && digits.startsWith("1")) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

/**
 * The panel's hotlines as Markdown, for a client that only renders answer
 * text (the web's Ask Gradus card).
 */
export function safeSportPanelMarkdown(): string {
  const lines = [
    "**If something doesn't feel right, you can talk to someone now:**",
    "",
    ...HOTLINES.map((h) => {
      const how = [h.tel ? `call ${formatTel(h.tel)}` : "", h.sms ? `text ${h.sms}` : ""]
        .filter(Boolean)
        .join(" or ");
      return `- **${h.name}**${how ? ` (${how})` : ""}: ${h.blurb} ${h.hours}. [${h.url.replace(/^https:\/\//, "").replace(/\/$/, "")}](${h.url})`;
    }),
  ];
  return lines.join("\n");
}

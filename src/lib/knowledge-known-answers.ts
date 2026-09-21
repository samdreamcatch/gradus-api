/**
 * Known-answer question set for the knowledge corpus (PRD §6.7, L4 "done
 * when": the expected source is in the top 3 for ≥ 90% of questions).
 *
 * Each case names a question a parent, athlete or coach would actually
 * ask and the source that should answer it, matched by title substring so
 * the set works before anyone has read every page. Run from the admin
 * panel (Content → Knowledge corpus → "Run known-answer set"). Add a case
 * whenever a source is added; a case whose source is not registered yet is
 * reported as "skipped", not failed. The ledger of sources is
 * docs/knowledge/SOURCES.md.
 */
export type KnownAnswerCase = {
  question: string;
  sport: string;
  /** Case-insensitive substring of the expected source's title. */
  titleContains: string;
};

export const KNOWN_ANSWER_CASES: KnownAnswerCase[] = [
  // The Athlete Survivors' Assist — the six safety PDFs in every sport's library.
  {
    question: "What are the warning signs that a coach is grooming my child?",
    sport: "figure_skating",
    titleContains: "Abuse in Sports",
  },
  {
    question: "Is it okay for my coach to text me privately at night?",
    sport: "figure_skating",
    titleContains: "Appropriate Athlete",
  },
  {
    question: "Why do athletes not report abuse by a coach?",
    sport: "tennis",
    titleContains: "Barriers to Reporting",
  },
  {
    question: "What does isolation from parents look like in a coaching relationship?",
    sport: "golf",
    titleContains: "Power and Control",
  },
  {
    question: "How do I make a safety plan if I am afraid of someone in my sport?",
    sport: "figure_skating",
    titleContains: "Survivor Safety Plan",
  },
  {
    question: "I think a teammate is being neglected at home. What should I do?",
    sport: "tennis",
    titleContains: "What to Do",
  },
  // Gradus-owned text: the Safe Sport panel copy.
  {
    question: "Who can I call right now if something with my coach feels wrong?",
    sport: "figure_skating",
    titleContains: "Safe Sport panel",
  },
  {
    question: "Is being yelled at and called names by a coach something I can report?",
    sport: "golf",
    titleContains: "Safe Sport panel",
  },
  // U.S. government publications (public domain), registered by URL when Mariah chooses.
  {
    question: "What are the symptoms of a concussion after a fall?",
    sport: "figure_skating",
    titleContains: "HEADS UP",
  },
  {
    question: "How much physical activity should a 12-year-old get each day?",
    sport: "tennis",
    titleContains: "Physical Activity Guidelines",
  },
  {
    question: "What does federal law require a coach to do if they suspect abuse?",
    sport: "golf",
    titleContains: "Safe Sport Authorization Act",
  },
];

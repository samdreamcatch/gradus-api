/**
 * The COPPA direct notice (16 CFR 312.4(c), as amended 2025): what Gradus
 * collects about a minor athlete, why, who processes it, how long it is
 * kept, and how the parent reviews or deletes it. One source for the
 * guardian-invite email (the notice a parent reads before claiming) and the
 * in-app block shown wherever a parent enters a minor's details: the sign-up
 * athletes step, the guardian claim, and Settings → Add an athlete
 * (PRD §6.13 A8, milestone S5, decision #40).
 *
 * `{athleteName}` is a noun phrase ("Rory", "your athletes"); `{siteUrl}` is
 * the public origin. The email default keeps the placeholders so the admin
 * copy editor can still override it; `renderDirectNotice` fills them.
 */

export const DIRECT_NOTICE = {
  keeps:
    "What Gradus keeps for {athleteName}: their name, date of birth, a username, practice logs, goals, and text messages with their coach, which you can always read.",
  use: "We use it only to run their training, never for advertising.",
  /** The sentence that carries the privacy-policy link; the app renders the link itself. */
  providersLead:
    "It is stored and delivered by our hosting, database, email, push-notification and AI-drafting providers, and Kids Web Services verifies parents; the full list is in ",
  providersLink: "our privacy policy",
  providersTail: ".",
  noAudio: "Athletes under 18 can't send voice recordings.",
  /** The retention rule itself (decisions #41–#42), so the notice does not lean on the policy page for it. */
  kept: "We keep it for as long as the account exists.",
  /** Email only, and only for an athlete who signed up themselves: a coach-added athlete is never swept. */
  unclaimed:
    "If nobody claims this account within three months, it and this email address are deleted.",
  dormant:
    "An account for an athlete under 18 that nobody has used for three years is deleted, after we email you first.",
  control: "From your parent account you can review or delete their information at any time.",
  /** In-app only: the click that follows the notice is the consent. */
  consentAct: "By continuing, you give your consent for {athleteName} on those terms.",
} as const;

/** The providers sentence as prose, with the policy URL spelled out (email, plain text). */
export const DIRECT_NOTICE_PROVIDERS_PROSE =
  DIRECT_NOTICE.providersLead +
  DIRECT_NOTICE.providersLink +
  " at {siteUrl}/privacy" +
  DIRECT_NOTICE.providersTail;

/** The guardian-invite email's default `notice` slot, placeholders intact. */
export const DIRECT_NOTICE_EMAIL_DEFAULT = [
  DIRECT_NOTICE.keeps,
  DIRECT_NOTICE.use,
  DIRECT_NOTICE_PROVIDERS_PROSE,
  DIRECT_NOTICE.noAudio,
  DIRECT_NOTICE.kept,
  DIRECT_NOTICE.dormant,
  DIRECT_NOTICE.control,
].join(" ");

/**
 * The email's extra line for a 13–17 self-sign-up (`noticeUnclaimed` slot):
 * only provisional accounts are swept after three months, so a coach-added
 * athlete's guardian must not read it.
 */
export const DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT = DIRECT_NOTICE.unclaimed;

export interface DirectNoticeVars {
  /** "Rory", "your athletes"; empty or null falls back to "your athlete". */
  athleteName?: string | null;
  siteUrl?: string;
}

export function directNoticeAthleteName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "your athlete";
}

/** Fill `{athleteName}` and `{siteUrl}` in one sentence. */
export function renderDirectNotice(template: string, vars: DirectNoticeVars = {}): string {
  return template
    .replaceAll("{athleteName}", directNoticeAthleteName(vars.athleteName))
    .replaceAll("{siteUrl}", vars.siteUrl ?? "https://gradus.training");
}

/**
 * The notice as plain sentences for a surface with no link rendering (iOS
 * mirrors this list; the web component composes the same parts with a Link).
 */
export function directNoticeSentences(
  vars: DirectNoticeVars & { unclaimed?: boolean; consentAct?: boolean } = {},
): string[] {
  const out = [
    DIRECT_NOTICE.keeps,
    DIRECT_NOTICE.use,
    DIRECT_NOTICE_PROVIDERS_PROSE,
    DIRECT_NOTICE.noAudio,
    DIRECT_NOTICE.kept,
  ];
  if (vars.unclaimed) out.push(DIRECT_NOTICE.unclaimed);
  out.push(DIRECT_NOTICE.dormant, DIRECT_NOTICE.control);
  if (vars.consentAct) out.push(DIRECT_NOTICE.consentAct);
  return out.map((s) => renderDirectNotice(s, vars));
}

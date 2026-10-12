/**
 * The COPPA direct notice (16 CFR 312.4(c), as amended 2025): what Gradus
 * collects about a minor athlete, why, who processes it, how long it is
 * kept, and how the parent reviews or deletes it. One source for the
 * guardian-invite email (the notice a parent reads before claiming) and the
 * in-app block shown wherever a parent enters a minor's details: the sign-up
 * athletes step, the guardian claim, and Settings → Add an athlete
 * (PRD §6.13 A8, milestone S5, decision #40).
 *
 * It leads with the safety promise: Gradus holds no photos or video of an
 * athlete (privacy policy §2.3), because nothing in the product can take,
 * attach or upload one for them. The required elements follow as short
 * labeled items a parent can scan.
 *
 * `{athleteName}` is a noun phrase ("Rory", "your athletes"), so no sentence
 * puts a possessive on it; `{siteUrl}` is the public origin. The email
 * defaults keep the placeholders so the admin copy editor can still override
 * them; `renderDirectNotice` fills them.
 */

export interface DirectNoticeItem {
  /** Bold lead-in, ending in a colon. */
  label: string;
  /** Lower-case continuation of the label. */
  text: string;
}

/** The words in `providers.text` that the app turns into the privacy-policy link. */
export const DIRECT_NOTICE_POLICY_LINK_TEXT = "our privacy policy";

export const DIRECT_NOTICE = {
  /** The headline: no profile pictures, and messages are text or voice only. */
  noMedia: "Gradus never collects photos or video of {athleteName}.",
  noMediaDetail:
    "There are no profile pictures, and messages can't carry photos or video. Athletes under 18 can't send voice recordings either.",
  keeps: {
    label: "What we keep:",
    text: "their name, date of birth, username, practice logs, goals, and text messages with their coach, which you can always read.",
  },
  use: {
    label: "How we use it:",
    text: "only to run their training, never for advertising.",
  },
  providers: {
    label: "Who handles it:",
    text: `our hosting, database, email, push-notification and AI-drafting providers store and deliver it, and Kids Web Services verifies parents. The full list is in ${DIRECT_NOTICE_POLICY_LINK_TEXT}.`,
  },
  /** The retention rule itself (decisions #41–#42), so the notice does not lean on the policy page for it. */
  kept: {
    label: "How long we keep it:",
    text: "for as long as the account exists. If an account for an athlete under 18 goes unused for three years, we email you, then delete it.",
  },
  /** Email only, and only for an athlete who signed up themselves: a coach-added athlete is never swept. */
  unclaimed: {
    label: "If you don't claim it:",
    text: "we delete this account and this email address after three months.",
  },
  control: {
    label: "You're in control:",
    text: "from your parent account you can review or delete their information at any time.",
  },
  /** In-app only: the click that follows the notice is the consent. */
  consentAct: "By continuing, you give your consent for {athleteName} on those terms.",
} as const;

/** The labeled items in reading order; the email adds `unclaimed` in its own slot. */
export const DIRECT_NOTICE_ITEMS: readonly DirectNoticeItem[] = [
  DIRECT_NOTICE.keeps,
  DIRECT_NOTICE.use,
  DIRECT_NOTICE.providers,
  DIRECT_NOTICE.kept,
  DIRECT_NOTICE.control,
];

/** The policy reference with its URL spelled out, for surfaces that can't render a link. */
function withPolicyUrl(text: string): string {
  return text.replace(
    DIRECT_NOTICE_POLICY_LINK_TEXT,
    `${DIRECT_NOTICE_POLICY_LINK_TEXT} at {siteUrl}/privacy`,
  );
}

/** One item as an email line: bold label, policy URL spelled out. */
function emailLine(item: DirectNoticeItem): string {
  return `<strong>${item.label}</strong> ${withPolicyUrl(item.text)}`;
}

/** The guardian-invite email's safety callout (`safetyHeading` / `safetyBody` slots). */
export const DIRECT_NOTICE_EMAIL_SAFETY_HEADING_DEFAULT = DIRECT_NOTICE.noMedia;
export const DIRECT_NOTICE_EMAIL_SAFETY_BODY_DEFAULT = DIRECT_NOTICE.noMediaDetail;

/** The guardian-invite email's default `notice` slot: one item per line, placeholders intact. */
export const DIRECT_NOTICE_EMAIL_DEFAULT = DIRECT_NOTICE_ITEMS.map(emailLine).join("\n");

/**
 * The email's extra line for a 13–17 self-sign-up (`noticeUnclaimed` slot):
 * only provisional accounts are swept after three months, so a coach-added
 * athlete's guardian must not read it.
 */
export const DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT = emailLine(DIRECT_NOTICE.unclaimed);

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
 * The notice as plain sentences for a surface with no markup (iOS mirrors
 * this list for VoiceOver; the web component composes the same parts with a
 * Link). The policy URL is spelled out.
 */
export function directNoticeSentences(
  vars: DirectNoticeVars & { unclaimed?: boolean; consentAct?: boolean } = {},
): string[] {
  // Same order as the email: the unclaimed line follows the other items.
  const items = vars.unclaimed
    ? [...DIRECT_NOTICE_ITEMS, DIRECT_NOTICE.unclaimed]
    : DIRECT_NOTICE_ITEMS;
  const out = [
    DIRECT_NOTICE.noMedia,
    DIRECT_NOTICE.noMediaDetail,
    ...items.map((item) => `${item.label} ${withPolicyUrl(item.text)}`),
  ];
  if (vars.consentAct) out.push(DIRECT_NOTICE.consentAct);
  return out.map((s) => renderDirectNotice(s, vars));
}

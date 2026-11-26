import type { MessageCategory, MessageMatch } from "./message-rules";

/** What the sender reads when a message is held (PRD #64; wording borrowed from Google). */
export const CONTENT_BLOCKED_MESSAGE =
  "This message may contain sensitive content and needs your attention. Please edit it and try again.";

export const MESSAGING_SUSPENDED_MESSAGE =
  "Messaging is paused on your account. Email support@gradussports.com if you think this is a mistake.";

export const FLAG_OUTCOMES = ["stopped", "sent_anyway", "sent"] as const;
export type FlagOutcome = (typeof FLAG_OUTCOMES)[number];

export const FLAG_OUTCOME_LABELS: Record<FlagOutcome, string> = {
  stopped: "Stopped (edited or abandoned)",
  sent_anyway: "Sent anyway",
  sent: "Sent (no warning)",
};

export type MessageCheckDecision =
  | { action: "send"; outcome: null }
  | { action: "send"; outcome: "sent"; crisisLine: true }
  | { action: "send"; outcome: "sent_anyway" }
  | { action: "refuse"; outcome: "stopped"; canSendAnyway: boolean; showSafeSport: boolean };

/**
 * What happens to a message the check matched (PRD #64).
 *
 * - Self-harm said about oneself: always sends, no warning; the sender is
 *   shown the 988 line.
 * - Anything else warns. "Send anyway" is never offered to an adult in a room
 *   with an athlete under 18, always offered to a sender under 18 (with the
 *   Safe Sport link, so a child's disclosure is never dead-ended), and offered
 *   to adults in rooms with no minor.
 */
export function decideMessageCheck(input: {
  match: MessageMatch | null;
  senderMinor: boolean;
  roomHasMinor: boolean;
  sendAnyway: boolean;
}): MessageCheckDecision {
  const { match, senderMinor, roomHasMinor, sendAnyway } = input;
  if (!match) return { action: "send", outcome: null };
  if (match.category === "self_harm") return { action: "send", outcome: "sent", crisisLine: true };
  const canSendAnyway = senderMinor || !roomHasMinor;
  if (sendAnyway && canSendAnyway) return { action: "send", outcome: "sent_anyway" };
  return { action: "refuse", outcome: "stopped", canSendAnyway, showSafeSport: senderMinor };
}

/** A flagged message that reached the room: sent anyway, or a voice note flagged after the fact. */
export function flagDelivered(flag: { outcome: FlagOutcome; category: string }): boolean {
  return (
    flag.outcome === "sent_anyway" || (flag.outcome === "sent" && flag.category !== "self_harm")
  );
}

/** Admin list order: delivered first, then anything a sender under 18 typed, then the rest. */
export function flagPriority(flag: {
  outcome: FlagOutcome;
  senderMinor: boolean;
  category: string;
}): number {
  if (flagDelivered(flag)) return 0;
  if (flag.senderMinor) return 1;
  return 2;
}

export type FlagCategory = MessageCategory;

export type AppEmailPayloadInput = {
  messageId: string;
  to: string;
  from: string;
  senderDomain: string;
  subject: string;
  html: string;
  text: string;
  label: string;
  idempotencyKey?: string;
  unsubscribeToken?: string;
};

/**
 * The provider requires every app email to carry an idempotency key and must
 * never receive an authentication run ID. Keep that contract in one place.
 */
export function buildAppEmailPayload(input: AppEmailPayloadInput) {
  if (!input.messageId || !input.to || !input.label) {
    throw new Error("Invalid app email payload");
  }

  return {
    message_id: input.messageId,
    to: input.to,
    from: input.from,
    sender_domain: input.senderDomain,
    subject: input.subject,
    html: input.html,
    text: input.text,
    purpose: "transactional" as const,
    label: input.label,
    idempotency_key: input.idempotencyKey || input.messageId,
    ...(input.unsubscribeToken ? { unsubscribe_token: input.unsubscribeToken } : {}),
    queued_at: new Date().toISOString(),
  };
}
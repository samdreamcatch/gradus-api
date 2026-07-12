// Single source of truth for editable copy across every email template.
// The admin editor at /admin/emails reads this schema to render fields;
// templates import defaults from here so audit view and rendered email agree.
//
// Variables in copy strings use {curlyBraces}. The renderer substitutes them
// from real send data; unknown variables render as literal text.

export type SlotKind = "text" | "textarea";

export interface Slot {
  key: string;
  label: string;
  kind: SlotKind;
  help?: string;
  /** Variables the renderer will substitute. Shown as chips in the editor. */
  variables?: readonly string[];
}

export interface TemplateCopy {
  displayName: string;
  category: "Auth" | "App" | "Internal";
  description: string;
  slots: readonly Slot[];
  defaults: Record<string, string>;
}

const AUTH_VARS = ["siteName", "siteUrl", "recipient", "confirmationUrl"] as const;

export const EMAIL_COPY_SCHEMA: Record<string, TemplateCopy> = {
  signup: {
    displayName: "Signup — confirm your email",
    category: "Auth",
    description: "Sent when a new user creates an account. Confirms their email address.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", help: "Short line shown in the inbox list next to the subject." },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: AUTH_VARS, help: "Supports {siteName}, {siteUrl}, {recipient}. Wrap emphasis with <strong>." },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Confirm your email to start training with Gradus",
      subject: "Confirm your email",
      eyebrow: "Confirm your email",
      heading: "One quick step to get started.",
      body: "Thanks for signing up for <strong>{siteName}</strong>. Confirm <strong>{recipient}</strong> so we can save your progress and connect you to your coach.",
      ctaLabel: "Verify my email",
      fallbackHelp: "Button not working? Paste this link into your browser:",
      signOff: "— The Gradus team",
      footer: "If you didn't create a Gradus account, you can safely ignore this email.",
    },
  },
  invite: {
    displayName: "Invite — join your coach",
    category: "Auth",
    description: "Sent when someone invites a new user to Gradus.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: AUTH_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "You've been invited to join Gradus",
      subject: "You've been invited",
      eyebrow: "You're invited",
      heading: "Join your coach on Gradus.",
      body: "You've been invited to join <strong>{siteName}</strong>. Accept the invitation to create your account and start training together.",
      ctaLabel: "Accept invitation",
      signOff: "— The Gradus team",
      footer: "If you weren't expecting this invitation, you can safely ignore this email.",
    },
  },
  magiclink: {
    displayName: "Magic link — sign in",
    category: "Auth",
    description: "One-tap sign-in link, sent when a user requests passwordless login.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: AUTH_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "fallbackHelp", label: "Fallback help line", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Your one-tap login link for Gradus",
      subject: "Your login link",
      eyebrow: "Sign-in link",
      heading: "Tap to sign in.",
      body: "Use the button below to log in to <strong>{siteName}</strong>. The link expires shortly, so use it soon.",
      ctaLabel: "Sign in to Gradus",
      fallbackHelp: "Or paste this URL into your browser:",
      footer: "If you didn't request this link, you can safely ignore this email.",
    },
  },
  recovery: {
    displayName: "Recovery — reset password",
    category: "Auth",
    description: "Sent when a user requests a password reset.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: AUTH_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "fallbackHelp", label: "Fallback help line", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Reset your Gradus password",
      subject: "Reset your password",
      eyebrow: "Password reset",
      heading: "Let's get you back in.",
      body: "We received a request to reset your password for <strong>{siteName}</strong>. Choose a new one with the button below.",
      ctaLabel: "Choose a new password",
      fallbackHelp: "Or paste this URL into your browser:",
      footer: "If you didn't request a password reset, you can safely ignore this email — your password will stay the same.",
    },
  },
  email_change: {
    displayName: "Email change — confirm new address",
    category: "Auth",
    description: "Sent when a user changes the email on their account.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: ["siteName", "oldEmail", "newEmail"] },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Confirm your email change for Gradus",
      subject: "Confirm your new email",
      eyebrow: "Email change request",
      heading: "Confirm your new email.",
      body: "You asked to change your <strong>{siteName}</strong> email from <a>{oldEmail}</a> to <a>{newEmail}</a>.",
      ctaLabel: "Confirm email change",
      footer: "<strong>Didn't request this?</strong> Reset your password right away to secure your account.",
    },
  },
  reauthentication: {
    displayName: "Reauthentication — verification code",
    category: "Auth",
    description: "Sent when a user needs to re-verify identity with a one-time code.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      { key: "body", label: "Main paragraph", kind: "textarea", variables: ["token"] },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Your Gradus verification code",
      subject: "Your verification code",
      eyebrow: "Verification code",
      heading: "Confirm it's you.",
      body: "Enter this code to finish signing in. It expires shortly.",
      footer: "If you didn't request a code, you can safely ignore this email.",
    },
  },
};

/** Substitute {variable} placeholders. Unknown variables render as literal text. */
export function renderTemplateString(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = values[key];
    return v == null ? match : String(v);
  });
}

/** Merge overrides over the schema defaults for a template. */
export function resolveCopy(
  templateName: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const schema = EMAIL_COPY_SCHEMA[templateName];
  if (!schema) return { ...overrides };
  return { ...schema.defaults, ...overrides };
}

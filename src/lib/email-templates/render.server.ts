// Server-only render helper. Kept out of client bundle by the .server.ts convention.
import * as React from "react";
import { render } from "@react-email/components";
import { SignupEmail } from "./signup";
import { InviteEmail } from "./invite";
import { MagicLinkEmail } from "./magic-link";
import { RecoveryEmail } from "./recovery";
import { EmailChangeEmail } from "./email-change";
import { ReauthenticationEmail } from "./reauthentication";

const TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

const SAMPLE_PROPS: Record<string, Record<string, any>> = {
  signup: {
    siteName: "Gradus",
    siteUrl: "https://gradus.training",
    recipient: "you@example.com",
    confirmationUrl: "https://gradus.training/confirm",
  },
  invite: {
    siteName: "Gradus",
    siteUrl: "https://gradus.training",
    confirmationUrl: "https://gradus.training/accept",
  },
  magiclink: {
    siteName: "Gradus",
    confirmationUrl: "https://gradus.training/magic",
  },
  recovery: {
    siteName: "Gradus",
    confirmationUrl: "https://gradus.training/reset",
  },
  email_change: {
    siteName: "Gradus",
    oldEmail: "old@example.com",
    email: "new@example.com",
    newEmail: "new@example.com",
    confirmationUrl: "https://gradus.training/confirm-change",
  },
  reauthentication: { token: "123456" },
};

export async function renderTemplatePreview(
  name: string,
  overrides: Record<string, string>,
): Promise<string> {
  const Component = TEMPLATES[name];
  if (!Component) throw new Error("Unknown template");
  const props = { ...(SAMPLE_PROPS[name] ?? {}), copyOverrides: overrides };
  return await render(React.createElement(Component, props));
}

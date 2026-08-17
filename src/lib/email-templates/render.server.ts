// Server-only render helper. Kept out of client bundle by the .server.ts convention.
import * as React from "react";
import { render } from "@react-email/components";
import { SignupEmail } from "./signup";
import { InviteEmail } from "./invite";
import { MagicLinkEmail } from "./magic-link";
import { RecoveryEmail } from "./recovery";
import { EmailChangeEmail } from "./email-change";
import { ReauthenticationEmail } from "./reauthentication";
import { GuardianInviteEmail } from "./guardian-invite";
import { GuardianActivityEmail } from "./guardian-activity";
import { WelcomeEmail } from "./welcome";
import { ActivationEmail } from "./activation";

const TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
  "guardian-invite": GuardianInviteEmail,
  "guardian-activity": GuardianActivityEmail,
  welcome: WelcomeEmail,
  activation: ActivationEmail,
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
  "guardian-invite": {
    athleteName: "Sample Athlete",
    coachName: "Tami Taylor",
    claimUrl: "https://gradus.training/g/preview-token",
    siteUrl: "https://gradus.training",
  },
  "guardian-activity": {
    athleteName: "Sample Athlete",
    senderName: "Tami Taylor",
    senderRole: "coach",
    body: "Great session today — let's work on the loop jump entry next week.",
    claimUrl: "https://gradus.training/g/preview-token",
    siteUrl: "https://gradus.training",
  },
  welcome: {
    firstName: "Alex",
    settingsUrl: "https://gradus.training/coach/settings",
    siteUrl: "https://gradus.training",
  },
  activation: {
    role: "parent",
    firstName: "Alex",
    settingsUrl: "https://gradus.training/parent/settings",
    siteUrl: "https://gradus.training",
  },
};

/** Role-specific sample props, used by the admin preview's user-type selector. */
const ROLE_PROPS: Record<string, Record<string, Record<string, any>>> = {
  welcome: {
    coach: { firstName: "Tami", settingsUrl: "https://gradus.training/coach/settings" },
    parent: { firstName: "Alex", settingsUrl: "https://gradus.training/parent/settings" },
    athlete: { firstName: "Jordan", settingsUrl: "https://gradus.training/athlete/settings" },
  },
  activation: {
    coach: { role: "coach", firstName: "Tami", settingsUrl: "https://gradus.training/coach/settings" },
    parent: { role: "parent", firstName: "Alex", settingsUrl: "https://gradus.training/parent/settings" },
    athlete: {
      role: "athlete",
      firstName: "Jordan",
      settingsUrl: "https://gradus.training/athlete/settings",
    },
  },
  "guardian-activity": {
    coach: { senderName: "Tami Taylor", senderRole: "coach" },
    athlete: { senderName: "Sample Athlete", senderRole: "athlete" },
  },
};

export async function renderTemplatePreview(
  name: string,
  overrides: Record<string, string>,
  role?: string,
): Promise<string> {
  const Component = TEMPLATES[name];
  if (!Component) throw new Error("Unknown template");
  const roleProps = (role && ROLE_PROPS[name]?.[role]) || {};
  const props = { ...(SAMPLE_PROPS[name] ?? {}), ...roleProps, copyOverrides: overrides };
  return await render(React.createElement(Component, props));
}

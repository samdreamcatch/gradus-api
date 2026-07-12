import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/components";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SignupEmail } from "./email-templates/signup";
import { InviteEmail } from "./email-templates/invite";
import { MagicLinkEmail } from "./email-templates/magic-link";
import { RecoveryEmail } from "./email-templates/recovery";
import { EmailChangeEmail } from "./email-templates/email-change";
import { ReauthenticationEmail } from "./email-templates/reauthentication";
import { EMAIL_COPY_SCHEMA } from "./email-templates/copy-schema";
import { dbError } from "./db-error";

const TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

const SAMPLE_PROPS: Record<string, Record<string, any>> = {
  signup: { siteName: "Gradus", siteUrl: "https://gradus.training", recipient: "you@example.com", confirmationUrl: "https://gradus.training/confirm" },
  invite: { siteName: "Gradus", siteUrl: "https://gradus.training", confirmationUrl: "https://gradus.training/accept" },
  magiclink: { siteName: "Gradus", confirmationUrl: "https://gradus.training/magic" },
  recovery: { siteName: "Gradus", confirmationUrl: "https://gradus.training/reset" },
  email_change: { siteName: "Gradus", oldEmail: "old@example.com", email: "new@example.com", newEmail: "new@example.com", confirmationUrl: "https://gradus.training/confirm-change" },
  reauthentication: { token: "123456" },
};

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** Renders a template with live-edit overrides (unsaved) for the admin preview iframe. */
export const previewEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string(),
      overrides: z.record(z.string(), z.string()).default({}),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const Component = TEMPLATES[data.name];
    if (!Component) throw new Error("Unknown template");
    if (!EMAIL_COPY_SCHEMA[data.name]) throw new Error("Unknown template");
    const props = { ...SAMPLE_PROPS[data.name], copyOverrides: data.overrides };
    const html = await render(React.createElement(Component, props));
    return { html };
  });

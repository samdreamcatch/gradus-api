import type { ComponentType } from "react";

export interface TemplateEntry {
  component: ComponentType<any>;
  subject: string | ((data: Record<string, any>) => string);
  displayName?: string;
  previewData?: Record<string, any>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
import { template as errorDigestTemplate } from "./error-digest";
import { template as guardianInviteTemplate } from "./guardian-invite";
import { template as guardianActivityTemplate } from "./guardian-activity";
import { template as welcomeTemplate } from "./welcome";
import { template as activationTemplate } from "./activation";
import { template as billingNoticeTemplate } from "./billing-notice";
import { template as clubInviteTemplate } from "./club-invite";
import { template as clubRemovalTemplate } from "./club-removal";
import { template as teamInviteTemplate } from "./team-invite";

export const TEMPLATES: Record<string, TemplateEntry> = {
  "error-digest": errorDigestTemplate,
  "guardian-invite": guardianInviteTemplate,
  "guardian-activity": guardianActivityTemplate,
  welcome: welcomeTemplate,
  activation: activationTemplate,
  "billing-notice": billingNoticeTemplate,
  "club-invite": clubInviteTemplate,
  "club-removal": clubRemovalTemplate,
  "team-invite": teamInviteTemplate,
};

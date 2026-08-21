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
  /** Delivery-only entries (e.g. global CC/BCC) have no renderable component. */
  noPreview?: boolean;
  category: "Auth" | "App" | "Internal";
  description: string;
  slots: readonly Slot[];
  defaults: Record<string, string>;
}

const AUTH_VARS = ["siteName", "siteUrl", "recipient", "confirmationUrl"] as const;

const WELCOME_VARS = ["firstName", "settingsUrl", "siteUrl"] as const;

const BILLING_VARS = ["firstName", "eventDate", "planLabel", "billingUrl", "siteUrl"] as const;

const GUARDIAN_INVITE_VARS = ["athleteName", "coachName", "claimUrl", "siteUrl"] as const;

const COACH_VISIBILITY_VARS = [
  "coachName",
  "otherCoachName",
  "athleteName",
  "parentName",
  "actionUrl",
  "siteUrl",
] as const;
const TEAM_INVITE_VARS = ["athleteName", "inviterName", "claimUrl", "code", "siteUrl"] as const;



const GUARDIAN_ACTIVITY_VARS = [
  "athleteName",
  "senderName",
  "senderRole",
  "senderLabel",
  "body",
  "claimUrl",
  "siteUrl",
] as const;

export const EMAIL_COPY_SCHEMA: Record<string, TemplateCopy> = {
  signup: {
    displayName: "Signup — confirm your email",
    category: "Auth",
    description: "Sent when a new user creates an account. Confirms their email address.",
    slots: [
      {
        key: "preview",
        label: "Inbox preview",
        kind: "text",
        help: "Short line shown in the inbox list next to the subject.",
      },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text" },
      {
        key: "body",
        label: "Main paragraph",
        kind: "textarea",
        variables: AUTH_VARS,
        help: "Supports {siteName}, {siteUrl}, {recipient}. Wrap emphasis with <strong>.",
      },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Confirm your email to start training with Gradus",
      subject: "Confirm your email",
      eyebrow: "Confirm your email",
      heading: "Secure your Gradus account.",
      body: "Thanks for signing up for <strong>Gradus</strong>. Confirm <strong>{recipient}</strong> so we can keep your training progress secure and help you reset your password if you ever get locked out.",
      ctaLabel: "Verify my email",
      fallbackHelp: "Button not working? Paste this link into your browser:",
      signOff: "— The Gradus team",
      footer: "If you didn't create a Gradus account, you can safely ignore this email.",
    },
  },
  invite: {
    displayName: "Invite — join me on Gradus",
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
      heading: "Start training with Gradus.",
      body: "You've been invited to join <strong>Gradus</strong>. Accept the invitation to create your account and start training together.",
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
      body: "Use the button below to log in to <strong>Gradus</strong>. The link expires in 1 hour, so use it soon.",
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
      body: "We received a request to reset your password for <strong>Gradus</strong>. Choose a new one with the button below.",
      ctaLabel: "Choose a new password",
      fallbackHelp: "Or paste this URL into your browser:",
      footer: "If you didn't request a password reset, you can safely ignore this email.",
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
      {
        key: "body",
        label: "Main paragraph",
        kind: "textarea",
        variables: ["siteName", "oldEmail", "newEmail"],
      },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Confirm your email change for Gradus",
      subject: "Confirm your new email",
      eyebrow: "Email change request",
      heading: "Confirm your new email.",
      body: "You asked to change your <strong>Gradus</strong> email from <a>{oldEmail}</a> to <a>{newEmail}</a>.",
      ctaLabel: "Confirm email change",
      footer:
        "<strong>Didn't request this?</strong> Reset your password right away to secure your account.",
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
      body: "Enter this code to finish signing in. It expires in 5 minutes.",
      footer: "If you didn't request a code, you can safely ignore this email.",
    },
  },
  "guardian-invite": {
    displayName: "Guardian invite",
    category: "App",
    description:
      "Sent to a parent or guardian listed on a youth athlete's account, with a link to claim their free parent account.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: GUARDIAN_INVITE_VARS },
      {
        key: "subject",
        label: "Subject line (athlete joined on their own)",
        kind: "text",
        variables: GUARDIAN_INVITE_VARS,
      },
      {
        key: "subjectWithCoach",
        label: "Subject line (coach added them)",
        kind: "text",
        variables: GUARDIAN_INVITE_VARS,
      },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text", variables: GUARDIAN_INVITE_VARS },
      {
        key: "introWithCoach",
        label: "Intro paragraph (coach added them)",
        kind: "textarea",
        variables: GUARDIAN_INVITE_VARS,
      },
      {
        key: "intro",
        label: "Intro paragraph (athlete joined on their own)",
        kind: "textarea",
        variables: GUARDIAN_INVITE_VARS,
      },
      {
        key: "body",
        label: "Secondary paragraph",
        kind: "textarea",
        variables: GUARDIAN_INVITE_VARS,
      },
      { key: "ctaLabel", label: "Button label", kind: "text", variables: GUARDIAN_INVITE_VARS },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "See everything {athleteName} is doing on Gradus",
      subject: "{athleteName} joined Gradus",
      subjectWithCoach: "Coach {coachName} added {athleteName} to Gradus",
      eyebrow: "Parent / guardian access",
      heading: "You've been listed as {athleteName}'s parent",
      introWithCoach:
        "Coach {coachName} added {athleteName} to Gradus, the training app their coach uses to assign plans, track practice, and message about lessons.",
      intro:
        "{athleteName} joined Gradus, the training app their coach uses to assign plans, track practice, and message about lessons.",
      body: "You were listed as their parent or guardian, so we'll email you a copy of what their coach sends. Create your free parent account to see plans, practice logs, and messages in one place — nothing to pay, and it takes about a minute.",
      ctaLabel: "See {athleteName}'s training",
      fallbackHelp: "Or paste this link into your browser:",
      signOff: "— The Gradus team",
      footer:
        "If you don't recognize this athlete, you can ignore this email and no account will be created.",
    },
  },
  "coach-visibility": {
    displayName: "Team plan — coach visibility request",
    category: "App",
    description:
      "Sent to each coach when a parent on the Team plan connects two of their athlete's coaches so they can see each other's work.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: COACH_VISIBILITY_VARS },
      { key: "subject", label: "Subject line", kind: "text", variables: COACH_VISIBILITY_VARS },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text", variables: COACH_VISIBILITY_VARS },
      { key: "intro", label: "Intro paragraph", kind: "textarea", variables: COACH_VISIBILITY_VARS },
      { key: "body", label: "Secondary paragraph", kind: "textarea", variables: COACH_VISIBILITY_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text", variables: COACH_VISIBILITY_VARS },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "{parentName} connected you with {otherCoachName} for {athleteName}",
      subject: "{otherCoachName} would like to share notes on {athleteName}",
      eyebrow: "Coach visibility",
      heading: "A parent connected you with another coach",
      intro:
        "{parentName} asked to connect you and {otherCoachName} on {athleteName}'s account. If you both agree, each of you can see the other's plans, practice log, goals, and lesson schedule for {athleteName} — read only, and for that athlete alone.",
      body: "Nothing is shared until you accept. You can decline, or turn the connection off later from your settings.",
      ctaLabel: "Review the request",
      fallbackHelp: "Or paste this link into your browser:",
      signOff: "— The Gradus team",
      footer:
        "You're getting this because a parent on the Team plan manages this athlete's coaches.",
    },
  },
  "team-invite": {
    displayName: "Team plan — guardian invite",
    category: "App",
    description:
      "Sent when a parent on the Team plan invites another parent or guardian to share access to their athlete.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: TEAM_INVITE_VARS },
      { key: "subject", label: "Subject line", kind: "text", variables: TEAM_INVITE_VARS },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text", variables: TEAM_INVITE_VARS },
      { key: "intro", label: "Intro paragraph", kind: "textarea", variables: TEAM_INVITE_VARS },
      { key: "body", label: "Secondary paragraph", kind: "textarea", variables: TEAM_INVITE_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text", variables: TEAM_INVITE_VARS },
      { key: "codeHelp", label: "Invite-code line", kind: "text", variables: TEAM_INVITE_VARS },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "{inviterName} added you to {athleteName}'s Gradus account",
      subject: "{inviterName} shared {athleteName}'s training with you",
      eyebrow: "Team plan",
      heading: "You've been added to {athleteName}'s account",
      intro:
        "{inviterName} invited you to share access to {athleteName} on Gradus — the app their coach uses to assign plans, track practice, and message about lessons.",
      body: "Accept the invite to see plans, log practice, and join the conversation with their coach. It's included in {inviterName}'s Team plan, so there's nothing for you to pay.",
      ctaLabel: "Accept invite",
      codeHelp: "Already have a Gradus account? Enter this code in Settings: {code}",
      fallbackHelp: "Or paste this link into your browser:",
      signOff: "— The Gradus team",
      footer:
        "If you don't recognize this athlete, you can ignore this email and nothing will change.",
    },
  },

  "guardian-activity": {
    displayName: "Guardian message copy",
    category: "App",
    description:
      "Mirror of a coach or athlete message, sent to a guardian who hasn't created their account yet.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: GUARDIAN_ACTIVITY_VARS },
      { key: "subject", label: "Subject line", kind: "text", variables: GUARDIAN_ACTIVITY_VARS },
      {
        key: "eyebrow",
        label: "Small caps eyebrow",
        kind: "text",
        variables: GUARDIAN_ACTIVITY_VARS,
      },
      { key: "heading", label: "Big headline", kind: "text", variables: GUARDIAN_ACTIVITY_VARS },
      {
        key: "body",
        label: "Explainer paragraph",
        kind: "textarea",
        variables: GUARDIAN_ACTIVITY_VARS,
      },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "New message about {athleteName} on Gradus",
      subject: "New message about {athleteName} on Gradus",
      eyebrow: "Copy for {athleteName}'s parent",
      heading: "{senderLabel} sent a message",
      body: "You're getting this because you're listed as {athleteName}'s parent or guardian and haven't created your Gradus account yet. Create it to reply and see everything in one place.",
      ctaLabel: "Create my parent account",
      footer: "These copies stop as soon as you create your account.",
    },
  },
  welcome: {
    displayName: "Welcome — after signup",
    category: "App",
    description:
      "Sent automatically to every new user right after signup, whatever their role. Points them to Settings to get connected.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text" },
      { key: "subject", label: "Subject line", kind: "text" },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text", variables: WELCOME_VARS },
      { key: "body", label: "Opening paragraph", kind: "textarea", variables: WELCOME_VARS },
      { key: "nextStep", label: "Next-step paragraph", kind: "textarea", variables: WELCOME_VARS },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "signOff", label: "Sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Welcome to Gradus — here's your first step",
      subject: "Welcome to Gradus",
      eyebrow: "Welcome",
      heading: "Welcome to Gradus, {firstName}.",
      body: "We're glad you're here. Gradus is where coaches, athletes, and parents stay on the same page between lessons.",
      nextStep:
        "Your next step is to get connected — with a coach, a parent, or an athlete, depending on who you are. Head to <strong>Settings</strong> to get started.",
      ctaLabel: "Go to Settings",
      signOff: "— Alyson and Mariah, Gradus co-founders",
      footer: "Questions? Just reply to this email.",
    },
  },
  activation: {
    displayName: "Activation — after first connection",
    category: "App",
    description:
      "Sent once, the first time someone completes a connection. Three versions — coach, parent, and adult athlete.",
    slots: [
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "signOff", label: "Sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },

      { key: "subjectCoach", label: "Coach — subject line", kind: "text" },
      { key: "previewCoach", label: "Coach — inbox preview", kind: "text" },
      { key: "headingCoach", label: "Coach — headline", kind: "text", variables: WELCOME_VARS },
      { key: "introCoach", label: "Coach — intro line", kind: "textarea", variables: WELCOME_VARS },
      {
        key: "bulletsCoach",
        label: "Coach — bullets (one per line)",
        kind: "textarea",
        help: "Each line becomes one bullet. <strong> is supported.",
      },

      { key: "subjectParent", label: "Parent — subject line", kind: "text" },
      { key: "previewParent", label: "Parent — inbox preview", kind: "text" },
      { key: "headingParent", label: "Parent — headline", kind: "text", variables: WELCOME_VARS },
      {
        key: "introParent",
        label: "Parent — intro line",
        kind: "textarea",
        variables: WELCOME_VARS,
      },
      {
        key: "bulletsParent",
        label: "Parent — bullets (one per line)",
        kind: "textarea",
        help: "Each line becomes one bullet. <strong> is supported.",
      },

      { key: "subjectAthlete", label: "Athlete — subject line", kind: "text" },
      { key: "previewAthlete", label: "Athlete — inbox preview", kind: "text" },
      { key: "headingAthlete", label: "Athlete — headline", kind: "text", variables: WELCOME_VARS },
      {
        key: "introAthlete",
        label: "Athlete — intro line",
        kind: "textarea",
        variables: WELCOME_VARS,
      },
      {
        key: "bulletsAthlete",
        label: "Athlete — bullets (one per line)",
        kind: "textarea",
        help: "Each line becomes one bullet. <strong> is supported.",
      },
    ],
    defaults: {
      eyebrow: "You're connected",
      ctaLabel: "Open Gradus",
      signOff: "— Alyson and Mariah, Gradus co-founders",
      footer: "Questions? Just reply to this email.",

      subjectCoach: "You're connected — here's how to get the most out of Gradus",
      previewCoach: "Create your first plan and a few custom moves",
      headingCoach: "You're connected, {firstName}.",
      introCoach: "Here's how to get rolling with your athlete:",
      bulletsCoach: [
        "<strong>Create your first plan.</strong> Use voice or search moves manually. The plan goes to your athlete — and their parent if they're a minor — so include the specific cues and language you use in lessons.",
        "<strong>Create custom moves and drills.</strong> Tap Add Moves in the move library, then Add New. Anything you create is saved to your library.",
        "<strong>Watch practice roll in.</strong> Once an athlete or their parent logs sessions, you'll see a summary of how practice has gone since you last saw them.",
        "<strong>Check their goals.</strong> Parents enter a goal for the season and for the long term — take a look so you can level-set on practice expectations.",
        "<strong>Invoice from lesson times.</strong> If parents add lesson times, you can send invoices in a couple of taps.",
      ].join("\n"),

      subjectParent: "You're connected — here's how to get the most out of Gradus",
      previewParent: "Align on goals, log practice, and keep your coach in the loop",
      headingParent: "You're connected, {firstName}.",
      introParent: "Here's how to make the most of Gradus:",
      bulletsParent: [
        "<strong>Finish connecting with your team.</strong> If you haven't already, head to Settings to connect with a coach or additional athletes.",
        "<strong>Start by aligning on goals.</strong> Research shows this is one of the most important parts of an athlete's development. Be honest about where you'd like your athlete to go long term so your coach can strategize with you early and often.",
        "<strong>Log practice sessions.</strong> Swipe across the top of a plan to start a session, and use your coach's notes to remind your athlete what to work on using the cues they provided — go from “do better” to specific feedback your coach noticed during a recent lesson.",
        "<strong>Swipe to end the session</strong> and log how it went. Your coach gets a summary of how much your athlete practiced and where they need support.",
        "<strong>Add lesson times</strong> to help provide structure. If your coach chooses, they can use those times for easy invoicing.",
        "<strong>Keep connecting.</strong> If your athlete has multiple coaches or plays multiple sports, they're welcome to use Gradus for all of it. Note: if your coach is on a club plan, they can choose to see the plans of peer coaches training your athlete, so no one duplicates efforts or coaches your child differently.",
      ].join("\n"),

      subjectAthlete: "You're connected — here's how to get the most out of Gradus",
      previewAthlete: "Align on goals, log practice, and keep your coach in the loop",
      headingAthlete: "You're connected, {firstName}.",
      introAthlete: "Here's how to make the most of Gradus:",
      bulletsAthlete: [
        "<strong>Finish connecting with your team.</strong> If you haven't already, head to Settings to take the next steps to connect with a coach.",
        "<strong>Start by aligning on goals.</strong> Research shows this is one of the most important parts of your development. Be honest about where you'd like to go long term so your coach can strategize with you early and often.",
        "<strong>Log practice sessions.</strong> Swipe across the top of a plan to start a session, and use your coach's notes to remind yourself what to work on using the cues they provided — go from “I need to do this better” to specific feedback your coach noticed during a recent lesson.",
        "<strong>Swipe to end the session</strong> and log how it went. Your coach gets a summary of how much you practiced and where you need support.",
        "<strong>Add lesson times</strong> to help provide structure. If your coach chooses, they can use those times for easy invoicing.",
        "<strong>Keep connecting.</strong> If you have multiple coaches or play multiple sports, you're welcome to use Gradus for all of it. Note: if your coach is on a club plan, they can choose to see the plans of peer coaches training you, so no one duplicates efforts or coaches you differently.",
      ].join("\n"),
    },
  },
  "billing-notice": {
    displayName: "Billing — trial ending / payment failed / canceled",
    category: "App",
    description:
      "Three billing notices for coaches: free trial ending in 3 days, a failed payment, and a subscription that ended after Stripe stopped retrying.",
    slots: [
      { key: "signOff", label: "Sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },

      { key: "subjectTrialEnding", label: "Trial ending — subject", kind: "text" },
      { key: "previewTrialEnding", label: "Trial ending — inbox preview", kind: "text" },
      { key: "eyebrowTrialEnding", label: "Trial ending — eyebrow", kind: "text" },
      {
        key: "headingTrialEnding",
        label: "Trial ending — headline",
        kind: "text",
        variables: BILLING_VARS,
      },
      {
        key: "bodyTrialEnding",
        label: "Trial ending — main paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      {
        key: "detailTrialEnding",
        label: "Trial ending — second paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      { key: "ctaLabelTrialEnding", label: "Trial ending — button label", kind: "text" },

      { key: "subjectPaymentFailed", label: "Payment failed — subject", kind: "text" },
      { key: "previewPaymentFailed", label: "Payment failed — inbox preview", kind: "text" },
      { key: "eyebrowPaymentFailed", label: "Payment failed — eyebrow", kind: "text" },
      {
        key: "headingPaymentFailed",
        label: "Payment failed — headline",
        kind: "text",
        variables: BILLING_VARS,
      },
      {
        key: "bodyPaymentFailed",
        label: "Payment failed — main paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      {
        key: "detailPaymentFailed",
        label: "Payment failed — second paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      { key: "ctaLabelPaymentFailed", label: "Payment failed — button label", kind: "text" },

      { key: "subjectCanceled", label: "Canceled — subject", kind: "text" },
      { key: "previewCanceled", label: "Canceled — inbox preview", kind: "text" },
      { key: "eyebrowCanceled", label: "Canceled — eyebrow", kind: "text" },
      {
        key: "headingCanceled",
        label: "Canceled — headline",
        kind: "text",
        variables: BILLING_VARS,
      },
      {
        key: "bodyCanceled",
        label: "Canceled — main paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      {
        key: "detailCanceled",
        label: "Canceled — second paragraph",
        kind: "textarea",
        variables: BILLING_VARS,
      },
      { key: "ctaLabelCanceled", label: "Canceled — button label", kind: "text" },
    ],
    defaults: {
      signOff: "— Alyson and Mariah, Gradus co-founders",
      footer: "Questions about billing? Just reply to this email.",

      subjectTrialEnding: "Your Gradus free trial ends in 3 days",
      previewTrialEnding: "Your card will be charged on {eventDate} unless you cancel",
      eyebrowTrialEnding: "Trial ending soon",
      headingTrialEnding: "Your free trial ends {eventDate}, {firstName}.",
      bodyTrialEnding:
        "Heads up — your free trial of <strong>{planLabel}</strong> ends on <strong>{eventDate}</strong>. When it does, the card on file is charged and your plan continues without interruption.",
      detailTrialEnding:
        "Nothing to do if you'd like to keep going. If you'd rather not continue, you can cancel any time before {eventDate} in billing settings and you won't be charged.",
      ctaLabelTrialEnding: "Manage my plan",

      subjectPaymentFailed: "We couldn't process your Gradus payment",
      previewPaymentFailed: "Update your card to keep your plan active",
      eyebrowPaymentFailed: "Action needed",
      headingPaymentFailed: "Your payment didn't go through.",
      bodyPaymentFailed:
        "We tried to charge the card on file for <strong>{planLabel}</strong> and it was declined. Your account is still active for now — we'll retry over the next few days.",
      detailPaymentFailed:
        "The quickest fix is to update your card in billing settings. If the retries run out, your plan is canceled and access to coach features stops.",
      ctaLabelPaymentFailed: "Update my card",

      subjectCanceled: "Your Gradus plan has ended",
      previewCanceled: "Your subscription was canceled — you can restart any time",
      eyebrowCanceled: "Plan ended",
      headingCanceled: "Your Gradus plan has ended, {firstName}.",
      bodyCanceled:
        "Your <strong>{planLabel}</strong> subscription has been canceled and coach features are now paused. Your athletes, plans, and history are all still here — nothing has been deleted.",
      detailCanceled:
        "You can restart whenever you're ready and pick up exactly where you left off.",
      ctaLabelCanceled: "Restart my plan",
    },
  },
  "club-invite": {
    displayName: "Club coach invite",
    category: "App",
    description:
      "Sent to a coach when a club admin invites them to join the club's Gradus plan.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: ["orgName"] },
      { key: "subject", label: "Subject line", kind: "text", variables: ["orgName"] },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      { key: "heading", label: "Big headline", kind: "text", variables: ["orgName"] },
      {
        key: "intro",
        label: "Intro paragraph",
        kind: "textarea",
        variables: ["orgName", "inviteCode"],
      },
      {
        key: "body",
        label: "Secondary paragraph",
        kind: "textarea",
        variables: ["orgName", "inviteCode"],
      },
      { key: "ctaLabel", label: "Button label", kind: "text", variables: ["orgName"] },
      { key: "fallbackHelp", label: "Button-not-working help", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "{orgName} invited you to coach on Gradus",
      subject: "{orgName} invited you to Gradus",
      eyebrow: "Club invitation",
      heading: "{orgName} invited you to Gradus.",
      intro:
        "<strong>{orgName}</strong> uses Gradus to assign practice plans, track sessions, and stay in touch with athletes and parents between lessons. Your seat is covered by the club — there's nothing to pay.",
      body: "Use the button below to accept, or enter the code <strong>{inviteCode}</strong> when you sign up.",
      ctaLabel: "Join {orgName} on Gradus",
      fallbackHelp: "Or paste this link into your browser:",
      signOff: "— The Gradus team",
      footer: "If you weren't expecting this invite, you can safely ignore this email.",
    },
  },
  "club-removal": {
    displayName: "Removed from club",
    category: "App",
    description:
      "Sent to a coach when they leave, or are removed from, a club plan. Explains the 90-day free window and the WELCOME_BACK discount.",
    slots: [
      { key: "preview", label: "Inbox preview", kind: "text", variables: ["orgName"] },
      { key: "subject", label: "Subject line", kind: "text", variables: ["orgName"] },
      { key: "eyebrow", label: "Small caps eyebrow", kind: "text" },
      {
        key: "heading",
        label: "Big headline",
        kind: "text",
        variables: ["firstName", "orgName"],
      },
      {
        key: "intro",
        label: "Intro paragraph",
        kind: "textarea",
        variables: ["orgName", "freeUntil"],
      },
      {
        key: "body",
        label: "Secondary paragraph",
        kind: "textarea",
        variables: ["freeUntil"],
      },
      { key: "ctaLabel", label: "Button label", kind: "text" },
      { key: "signOff", label: "Handwritten sign-off", kind: "text" },
      { key: "footer", label: "Fine-print footer", kind: "textarea" },
    ],
    defaults: {
      preview: "Your Gradus account stays free until {freeUntil}",
      subject: "Your {orgName} club seat has ended",
      eyebrow: "Club plan ended",
      heading: "Your club seat has ended, {firstName}.",
      intro:
        "You're no longer on <strong>{orgName}</strong>'s Gradus plan. Nothing has been deleted — your athletes, plans, and history are all still here.",
      body: "Your account stays free until <strong>{freeUntil}</strong>. After that, pick a Coach or Coach Pro plan to keep going — we've already applied your <strong>WELCOME_BACK</strong> discount, so your first 3 months are free when you upgrade.",
      ctaLabel: "See my plan options",
      signOff: "— The Gradus team",
      footer: "Questions? Just reply to this email.",
    },
  },
};


/** Pseudo-template holding CC/BCC that applies to every email the app sends. */
export const GLOBAL_DELIVERY_TEMPLATE = "__global";

/** CC / BCC fields appended to every template so admins can edit them. */
export const DELIVERY_SLOTS: readonly Slot[] = [
  {
    key: "cc",
    label: "CC (copy to)",
    kind: "text",
    help: "Comma-separated email addresses. Leave blank for none.",
  },
  {
    key: "bcc",
    label: "BCC (blind copy to)",
    kind: "text",
    help: "Comma-separated email addresses. Recipients never see these.",
  },
];

export function isDeliverySlot(key: string): boolean {
  return DELIVERY_SLOTS.some((s) => s.key === key);
}

/** Split a comma/semicolon/whitespace separated address list into clean addresses. */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[,;\s]+/)
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.includes("@")),
    ),
  );
}

EMAIL_COPY_SCHEMA[GLOBAL_DELIVERY_TEMPLATE] = {
  displayName: "Global CC / BCC (all emails)",
  category: "Internal",
  noPreview: true,
  description: "Addresses copied on every email Gradus sends, on top of any per-template CC/BCC.",
  slots: DELIVERY_SLOTS,
  defaults: { cc: "", bcc: "" },
};

// Every template gets editable CC/BCC fields.
for (const [name, template] of Object.entries(EMAIL_COPY_SCHEMA)) {
  if (name === GLOBAL_DELIVERY_TEMPLATE) continue;
  template.slots = [...template.slots, ...DELIVERY_SLOTS];
  template.defaults = { cc: "", bcc: "", ...template.defaults };
}

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

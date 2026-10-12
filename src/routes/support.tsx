import { createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal-urls";
import { GRADUS_SUPPORT_EMAIL, REPORT_TO_GRADUS } from "@/lib/safe-sport-content";

/**
 * `gradus.training/support` (PRD decision #34, milestone S4): the support
 * contact, the response commitment for reports (Guideline 1.2), and short
 * answers to what parents and athletes ask. Kids Web Services' go-live
 * review and the App Store listing both point here. Public, no sign-in, and
 * excluded from the AASA like `/privacy`, so it always opens in Safari.
 */
export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — Gradus" },
      {
        name: "description",
        content:
          "Contact Gradus support, report a safety concern, and find answers about accounts for coaches, parents, and athletes.",
      },
    ],
  }),
  component: SupportPage,
});

type Faq = { q: string; a: string };

/** Each answer describes what the product does today; keep them in step with it. */
const SUPPORT_FAQS: Faq[] = [
  {
    q: "Why does Gradus ask parents to verify they're an adult?",
    a: "So that the adult in every conversation with a minor really is an adult. Each parent account linked to an athlete under 18 is verified once by Kids Web Services, a parental-verification service from Epic Games, using a payment card or the last four digits of a Social Security number on its own secure page. Gradus never sees those details, only the result.",
  },
  {
    q: "My child is under 13. How do they join?",
    a: "A parent or guardian creates the account: sign up as a parent, add your child, and give them the login code Gradus shows you. Athletes under 13 can't sign up on their own, and nothing about them is saved until you add them.",
  },
  {
    q: "My teenager signed up. Why can't they message their coach yet?",
    a: "Athletes aged 13 to 17 who sign up themselves start in waiting mode: their own goals and plans work right away, and coach connections and messages open once a parent or guardian confirms the account from the email we send. Accounts nobody confirms are removed after three months.",
  },
  {
    q: "Can a coach message my child privately?",
    a: "No. Every conversation with an athlete under 18 includes their parent or guardian, and athletes under 18 send text only. A parent can pause a coach's messaging at any time from Settings → My athletes.",
  },
  {
    q: "How do I report something?",
    a: `${REPORT_TO_GRADUS.body} ${REPORT_TO_GRADUS.commitment}`,
  },
  {
    q: "How do I buy or change a plan?",
    a: "Plans are bought and managed on gradus.training, never in the app. In the iOS app, Settings → Plan opens this site signed in.",
  },
  {
    q: "I forgot my password.",
    a: "Choose Forgot password? on the sign-in screen and we'll email a reset link. Athletes who sign in with a username can ask their parent, who can set a new password from Settings → My athletes.",
  },
  {
    q: "How do I delete my account?",
    a: "Settings → Account & security → Delete account, in the app or on gradus.training. It permanently deletes your account and personal data.",
  },
];

function SupportPage() {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="mb-8">
        <button
          type="button"
          onClick={() => (canGoBack ? router.history.back() : void router.navigate({ to: "/" }))}
          className="press text-sm text-text-secondary underline-offset-2"
        >
          ← Back
        </button>
      </div>

      <article className="space-y-10 text-text-primary">
        <header className="space-y-3">
          <h1 className="font-display text-4xl">Support</h1>
          <p className="text-text-secondary">
            Questions about Gradus, your account, or your athlete's? Email{" "}
            <a
              href={`mailto:${GRADUS_SUPPORT_EMAIL}`}
              className="font-medium text-accent-ink underline underline-offset-2"
            >
              {GRADUS_SUPPORT_EMAIL}
            </a>
            . We respond within one business day.
          </p>
        </header>

        <section aria-labelledby="safety" className="space-y-3">
          <h2 id="safety" className="font-display text-2xl">
            Safety concerns
          </h2>
          <p className="text-text-secondary">{REPORT_TO_GRADUS.body}</p>
          <p className="text-text-secondary">{REPORT_TO_GRADUS.commitment}</p>
          <p className="text-text-secondary">
            To report abuse or misconduct in sport, contact the{" "}
            <a
              href="https://uscenterforsafesport.org/report-a-concern/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent-ink underline underline-offset-2"
            >
              U.S. Center for SafeSport
            </a>{" "}
            (1-866-367-6272). If anyone is in immediate danger, call 911.
          </p>
        </section>

        <section aria-labelledby="faq" className="space-y-6">
          <h2 id="faq" className="font-display text-2xl">
            Common questions
          </h2>
          <dl className="space-y-6">
            {SUPPORT_FAQS.map((f) => (
              <div key={f.q} className="space-y-1">
                <dt className="font-medium text-text-primary">{f.q}</dt>
                <dd className="text-text-secondary">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="border-t border-divider pt-6 text-sm text-text-secondary">
          Gradus Sports, Inc. ·{" "}
          <a href={PRIVACY_POLICY_URL} className="underline underline-offset-2">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href={TERMS_OF_SERVICE_URL} className="underline underline-offset-2">
            Terms of Service
          </a>
        </footer>
      </article>
    </div>
  );
}

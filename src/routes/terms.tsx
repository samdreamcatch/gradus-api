import { createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Gradus" },
      {
        name: "description",
        content:
          "Gradus Sports, Inc. Terms of Service, based on the Common Paper Cloud Service Agreement v2.1.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
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

      <article className="prose-gradus space-y-6 text-text-primary">
        <header>
          <h1 className="font-display text-4xl">Gradus Sports, Inc. Terms of Service</h1>
          <p className="mt-2 text-sm text-text-secondary">Last Updated: June 29, 2026</p>
        </header>

        <p>
          If you signed a separate Cover Page to access the Product with the same account, and that
          agreement has not ended, the terms below do not apply to you. Instead, your separate Cover
          Page applies to your use of the Product.
        </p>

        <p>
          This Agreement is between Gradus Sports, Inc. and the company or person accessing or using
          the Product. This Agreement consists of: (1) the Order Form below and (2) the Framework
          Terms defined below.
        </p>

        <p>
          If you are accessing or using the Product on behalf of your company, you represent that
          you are authorized to accept this Agreement on behalf of your company. By signing up,
          accessing, or using the Product, Customer indicates its acceptance of this Agreement and
          agrees to be bound by the terms and conditions of this Agreement.
        </p>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Cover Page</h2>
          <p className="text-sm italic text-text-secondary">Order Form</p>

          <p>
            <strong>Framework Terms:</strong> This Order Form incorporates and is governed by the
            Framework Terms that are made up of the Key Terms below and the{" "}
            <a
              href="https://commonpaper.com/standards/cloud-service-agreement/2.1/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Common Paper Cloud Service Agreement Standard Terms Version 2.1
            </a>
            , which are incorporated by reference. Any modifications to the Standard Terms made in
            the Cover Page will control over conflicts with the Standard Terms. Capitalized words
            have the meanings given in the Cover Page or the Standard Terms.
          </p>

          <p>
            <strong>Cloud Service:</strong> Gradus is an app that allows coaches to build
            structured, between-lesson plans for their youth athletes to practice with their parents
            or guardians, extending the coach's expertise and guidance between lessons, and arming
            the parent or guardian with the confidence needed to support their athlete without
            having to play coach themselves.
          </p>

          <p>
            <strong>Order Date:</strong> The Effective Date
          </p>
          <p>
            <strong>Subscription Period:</strong> 1 month(s)
          </p>

          <p>
            Certain parts of the Product have different pricing plans, which are available at
            Provider's pricing page. Customer will pay Provider the applicable Fees based on the
            Product tier and Customer's usage. Provider may update Product pricing by giving at
            least 30 days notice to Customer (including by email or notification within the
            Product), and the change will apply in the next Subscription Period.
          </p>

          <p>
            <strong>Payment Process:</strong>
            <br />
            Automatic payment: Customer authorizes Provider to bill and charge Customer's payment
            method on file Monthly for immediate payment or deduction without further approval.
          </p>

          <p>
            <strong>Non-Renewal Notice Period:</strong> At least 30 days before the end of the
            current Subscription Period.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Key Terms</h2>

          <p>
            <strong>Customer:</strong> The company or person who accesses or uses the Product. If
            the person accepting this Agreement is doing so on behalf of a company, all use of the
            word "Customer" in the Agreement will mean that company.
          </p>
          <p>
            <strong>Provider:</strong> Gradus Sports, Inc.
          </p>
          <p>
            <strong>Effective Date:</strong> The date Customer first accepts this Agreement.
          </p>
          <p>
            <strong>Governing Law:</strong> The laws of the State of Delaware
          </p>
          <p>
            <strong>Chosen Courts:</strong> The state or federal courts located in Delaware
          </p>

          <p>
            <strong>Covered Claims:</strong>
          </p>
          <p>
            <strong>Provider Covered Claims:</strong> Any action, proceeding, or claim that the
            Cloud Service, when used by Customer according to the terms of the Agreement, violates,
            misappropriates, or otherwise infringes upon anyone else's intellectual property or
            other proprietary rights.
          </p>
          <p>
            <strong>Customer Covered Claims:</strong> Any action, proceeding, or claim that (1) the
            Customer Content, when used according to the terms of the Agreement, violates,
            misappropriates, or otherwise infringes upon anyone else's intellectual property or
            other proprietary rights; or (2) results from Customer's breach or alleged breach of
            Section 2.1 (Restrictions on Customer).
          </p>

          <p>
            <strong>General Cap Amount:</strong> The fees paid or payable by Customer to Provider in
            the 12 month period immediately before the claim.
          </p>

          <p>
            <strong>Notice Address:</strong>
            <br />
            For Provider: support@gradussports.com
            <br />
            For Customer: The main email address on Customer's account
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Standard Terms</h2>
          <p>
            The full Common Paper Cloud Service Agreement Standard Terms (Version 2.1) are
            incorporated by reference and available at{" "}
            <a
              href="https://commonpaper.com/standards/cloud-service-agreement/2.1/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              commonpaper.com/standards/cloud-service-agreement/2.1/
            </a>
            .
          </p>
        </section>

        <footer className="border-t border-divider pt-6 text-sm text-text-secondary">
          Questions? Email{" "}
          <a href="mailto:support@gradussports.com" className="underline">
            support@gradussports.com
          </a>
          .
        </footer>
      </article>
    </div>
  );
}

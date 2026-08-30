import { createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";

/**
 * Privacy Policy.
 *
 * This is a verbatim copy of the policy published at
 * https://www.gradussports.com/privacy. Do not edit the wording here —
 * the two must stay identical, and changes go through counsel first.
 * If the published policy is revised, mirror it into this file unchanged.
 */
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Gradus" },
      {
        name: "description",
        content:
          "How Gradus Sports, Inc. collects, uses, discloses, and retains personal information for coaches, parents, and youth athletes.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
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
          <h1 className="font-display text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Gradus Sports, Inc. · Effective Date: June 26, 2026 · Last Updated: June 26, 2026
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">0. Notice at Collection (California residents)</h2>
          <p>
            This notice, provided under the California Consumer Privacy Act as amended by the
            California Privacy Rights Act (the "CPRA"), summarizes the categories of personal
            information we collect and our practices at the point of collection.
          </p>

          <p>
            <strong>Categories of personal information we collect</strong>
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Identifiers (name, email, phone if you provide it, account identifiers)</li>
            <li>
              Customer records information (contact details and any details you submit through forms
              or in-app)
            </li>
            <li>
              Commercial information (records of your interactions with the Service, subscription
              status once available)
            </li>
            <li>
              Internet or other electronic network activity information (usage logs, device and
              browser data)
            </li>
            <li>Inferences drawn from the above to personalize the Service</li>
            <li>
              For Athlete accounts: name and date of birth only, plus in-app practice responses and
              messages
            </li>
          </ul>

          <p>
            <strong>Purposes</strong>
          </p>
          <p>
            We use these categories to provide and improve the Service, communicate about the beta
            and product updates, secure the Service, and comply with law. We do not use personal
            information for purposes materially different from those disclosed here without
            providing notice.
          </p>

          <p>
            <strong>Sensitive personal information</strong>
          </p>
          <p>
            We do not use or disclose sensitive personal information for purposes that would trigger
            a consumer's right to limit under CPRA § 1798.121.
          </p>

          <p>
            <strong>Sale / sharing for cross-context behavioral advertising</strong>
          </p>
          <p>
            We do not sell personal information and we do not share personal information for
            cross-context behavioral advertising as those terms are defined under the CPRA. We honor
            Global Privacy Control (GPC) signals as an opt-out for any future sharing.
          </p>

          <p>
            <strong>Retention</strong>
          </p>
          <p>
            We retain each category only as long as reasonably necessary for the purpose it was
            collected. See Section 8 for the specific retention periods.
          </p>

          <p>
            To exercise your rights, visit gradussports.com/privacy-requests or email
            privacy@gradussports.com. You may also configure the "Your Privacy Choices" link in our
            footer.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">1. Introduction</h2>
          <p>
            This Privacy Policy describes how Gradus Sports, Inc. ("Company," "we," "us," or "our")
            collects, uses, discloses, and retains personal information in connection with the
            Gradus mobile application and related services (collectively, the "Service"). This
            Policy applies to all users of the Service, including coaches, parents or legal
            guardians ("Parents"), and athlete users ("Athletes"), within the United States.
          </p>
          <p>
            By accessing or using the Service, you acknowledge that you have read and understood
            this Privacy Policy. If you are a Parent creating an account on behalf of an Athlete,
            you are acting on that Athlete's behalf and providing consent as described herein.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">2. Information We Collect</h2>

          <h3 className="font-display text-xl">2.1 Information Provided by Coaches</h3>
          <p>When a coach registers for and uses the Service, we collect:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Full name and email address</li>
            <li>Sport(s) coached and any optional profile information</li>
            <li>
              Practice plans, skill content, assigned moves, and coaching notes created within the
              Service
            </li>
            <li>Communications transmitted through the in-app messaging thread</li>
          </ul>

          <h3 className="font-display text-xl">2.2 Information Provided by Parents</h3>
          <p>When a Parent registers for and uses the Service, we collect:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Full name and email address</li>
            <li>
              The Athlete's first name and date of birth, provided by the Parent when creating the
              Athlete's profile
            </li>
            <li>Communications transmitted through the in-app messaging thread</li>
          </ul>

          <h3 className="font-display text-xl">2.3 Information Provided by Athletes</h3>
          <p>
            Athlete accounts are created by Parents. We collect only the following personal
            information from or about Athletes:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>First name (entered by Parent at account creation)</li>
            <li>Date of birth (entered by Parent at account creation)</li>
            <li>
              Practice responses, session check-ins, and content submitted within assigned practice
              plans
            </li>
            <li>Communications transmitted through the in-app messaging thread</li>
          </ul>
          <p>
            We do not collect email addresses, phone numbers, physical addresses, photographs, or
            video content from or about Athletes.
          </p>

          <h3 className="font-display text-xl">2.4 Information Collected Automatically</h3>
          <p>
            We may automatically collect certain technical and usage information when you access the
            Service, including:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Device type, operating system, and application version</li>
            <li>Features accessed, session duration, and aggregate usage patterns</li>
            <li>Crash reports and diagnostic data</li>
            <li>
              Cookies and similar session technologies used to maintain authentication state and
              analyze aggregate usage
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">3. How We Use Personal Information</h2>
          <p>We use the personal information we collect for the following purposes:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              To create and authenticate user accounts and deliver the core features of the Service
            </li>
            <li>
              To facilitate practice plan assignment, session tracking, and coach-athlete-parent
              communication
            </li>
            <li>
              To operate AI-assisted features within the Service, including session summaries,
              practice recommendations, and speech-to-text transcription of coach input, as further
              described in Section 6
            </li>
            <li>To send transactional and operational notifications related to Service activity</li>
            <li>To provide customer support and respond to user inquiries</li>
            <li>
              To detect, investigate, and prevent fraudulent, unauthorized, or illegal activity
            </li>
            <li>To analyze de-identified, aggregate usage data for product improvement purposes</li>
            <li>To comply with applicable legal obligations</li>
          </ul>
          <p>
            We will not use personal information for purposes materially different from those listed
            above without providing prior notice and, where required by law, obtaining consent.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">4. Disclosure of Personal Information</h2>

          <h3 className="font-display text-xl">4.1 Within the Service</h3>
          <p>
            The Service is structured as a three-party platform. Coaches, Parents, and Athletes
            connected within a practice relationship share access to a common communication thread
            and to the practice content assigned to that Athlete. This structure is a core feature
            of the Service; there are no private communication channels between a coach and an
            Athlete that exclude the connected Parent.
          </p>

          <h3 className="font-display text-xl">4.2 Third-Party Service Providers</h3>
          <p>
            We disclose personal information to a limited set of third-party service providers that
            assist us in operating the Service. Current service providers include:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Supabase — database infrastructure and data storage</li>
            <li>ElevenLabs — AI-powered speech synthesis and voice processing features</li>
            <li>Lovable Cloud — application development and hosting infrastructure</li>
            <li>
              Google LLC — email and productivity services (Google Workspace); AI model inference
              for in-app features (Google Gemini)
            </li>
          </ul>
          <p>
            All service providers are contractually required to process personal information only as
            directed by us, to maintain appropriate technical and organizational security measures,
            and not to use personal information for their own independent purposes. We will update
            this list as our service provider relationships change.
          </p>

          <h3 className="font-display text-xl">4.3 Legal Process and Safety</h3>
          <p>
            We may disclose personal information where we believe in good faith that such disclosure
            is required to: (a) comply with applicable law or respond to valid legal process,
            including subpoenas or court orders; (b) protect the rights, property, or safety of
            Gradus Sports, Inc., our users, or the public; or (c) enforce our Terms of Service.
          </p>

          <h3 className="font-display text-xl">4.4 Business Transfers</h3>
          <p>
            In the event of a merger, acquisition, reorganization, or sale of all or substantially
            all of our assets, personal information may be transferred to the successor entity. We
            will provide notice of such a transfer and require that the successor entity honor the
            commitments in this Privacy Policy or provide users with the opportunity to delete their
            accounts prior to the transfer taking effect.
          </p>

          <h3 className="font-display text-xl">4.5 No Sale of Personal Information</h3>
          <p>
            We do not sell personal information. We do not disclose personal information to third
            parties for advertising or direct marketing purposes. We may use de-identified or
            aggregated data — which cannot reasonably be used to identify any individual — for
            internal product improvement and analytics purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">5. Children's Privacy</h2>

          <h3 className="font-display text-xl">5.1 Applicability</h3>
          <p>
            The Service is designed for use by youth athletes. All Athlete accounts on the Service
            are held by individuals under the age of 18. We comply with the Children's Online
            Privacy Protection Act (COPPA) with respect to Athletes under the age of 13, and we
            apply consistent protections to all Athlete accounts regardless of age.
          </p>

          <h3 className="font-display text-xl">5.2 Parental Consent</h3>
          <p>
            Athlete accounts cannot be created by Athletes themselves. An Athlete account is created
            by a Parent during the Parent's own account registration. By creating an Athlete
            profile, the Parent represents and warrants that they are the Athlete's parent or legal
            guardian and provides verifiable parental consent under COPPA for the collection and use
            of the Athlete's personal information as described in this Privacy Policy.
          </p>
          <p>
            We do not knowingly collect personal information directly from children under 13 without
            prior verifiable parental consent. If we learn that we have inadvertently collected such
            information without consent, we will delete it promptly. To report such a concern,
            contact us at support@gradussports.com.
          </p>

          <h3 className="font-display text-xl">5.3 Limitations on Athlete Data</h3>
          <p>With respect to Athlete accounts, we:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Collect only a name and date of birth as personal identifiers</li>
            <li>Do not collect contact information from Athletes</li>
            <li>Do not make Athlete profiles publicly visible</li>
            <li>
              Do not use Athlete information for advertising, behavioral profiling, or any purpose
              unrelated to providing the Service
            </li>
            <li>
              Do not permit Athletes to communicate with any party outside their connected coach and
              Parent within the Service
            </li>
          </ul>

          <h3 className="font-display text-xl">5.4 Parental Rights</h3>
          <p>
            A Parent may at any time request access to, correction of, or deletion of their
            Athlete's personal information by contacting us at support@gradussports.com. We will
            process such requests as described in Section 8.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">6. Artificial Intelligence Features</h2>
          <p>
            The Service incorporates AI-assisted features including, but not limited to, session
            summaries, practice recommendations, and speech-to-text transcription of coach input.
            These features are powered in part by third-party providers, including Google LLC
            (Google Gemini) and ElevenLabs, which are listed in Section 4.2 and subject to the data
            processing requirements described therein.
          </p>
          <p>
            We do not use personal information of Athletes to train AI models, whether operated by
            us or by our service providers. AI-generated outputs are made available only to the
            coach and Parent associated with the relevant practice relationship.
          </p>
          <p>
            We may introduce additional AI-assisted features in the future. Material changes to how
            AI features process personal information will be reflected in an updated Privacy Policy
            with advance notice to users.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">7. Data Retention</h2>
          <p>
            We retain personal information for as long as necessary to provide the Service and
            fulfill the purposes described in this Privacy Policy, unless a longer retention period
            is required by applicable law.
          </p>
          <p>
            Upon deletion of a coach account, we retain practice plans, assigned moves, and coaching
            notes created by that coach, as this content forms part of the ongoing record of the
            coaching relationship and may be referenced by connected Parents. Personal information
            associated with the coach account (name and email address) will be deleted or
            de-identified within a reasonable period following account deletion.
          </p>
          <p>
            Upon deletion of a Parent account or upon a Parent's request for deletion of an
            Athlete's information, we will delete personal information associated with that Parent
            and Athlete (including name, date of birth, and communications) within a reasonable
            period, except where retention is required by applicable law or for the purpose of
            resolving disputes or preventing fraud.
          </p>
          <p>
            Requests for deletion of personal information may be submitted to
            support@gradussports.com.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">8. User Rights and Requests</h2>
          <p>Subject to applicable law, users may have the right to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Access the personal information we hold about them</li>
            <li>Request correction of inaccurate or incomplete personal information</li>
            <li>Request deletion of personal information</li>
            <li>Request a portable copy of their personal information</li>
            <li>Object to or request restriction of certain processing activities</li>
          </ul>
          <p>
            To exercise any of the above rights, please submit a written request to
            support@gradussports.com. We will respond within the timeframe required by applicable
            law. We may require verification of your identity prior to processing any request. We
            reserve the right to deny requests that are unfounded, excessive, or prohibited by law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">9. Data Security</h2>
          <p>
            We implement technical and organizational measures designed to protect personal
            information against unauthorized access, disclosure, alteration, or destruction. These
            measures include encryption of data in transit and at rest, access controls limiting
            internal access to personal information, and periodic review of our security practices.
          </p>
          <p>
            No method of electronic transmission or storage is completely secure. We cannot
            guarantee absolute security. In the event of a data breach that requires notification
            under applicable law, we will notify affected users in accordance with those
            requirements.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">10. Third-Party Links and Services</h2>
          <p>
            The Service may contain links to third-party websites or services not owned or
            controlled by Gradus Sports, Inc. This Privacy Policy does not apply to those
            third-party services. We encourage users to review the privacy policies of any
            third-party services they access.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">11. Changes to This Privacy Policy</h2>
          <p>
            We reserve the right to update this Privacy Policy at any time. If we make material
            changes, we will provide notice by posting the updated Policy within the Service and
            updating the Effective Date above. For material changes affecting the processing of
            Athlete personal information, we will provide additional notice to affected Parents by
            email. Continued use of the Service following the effective date of any update
            constitutes acceptance of the updated Policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">12. Contact Information</h2>
          <p>
            Questions, requests, or concerns regarding this Privacy Policy should be directed to:
          </p>
          <p>Gradus Sports, Inc.</p>
          <p>Email: support@gradussports.com</p>
          <p>Mailing Address: 1622 N Washington Ave, Royal Oak, MI 48067</p>
        </section>

        <hr className="border-divider" />

        <section className="space-y-3">
          <h2 className="font-display text-2xl">ADDENDUM A</h2>
          <p>
            <strong>Additional Disclosures for California Residents</strong>
          </p>
          <p className="text-sm italic text-text-secondary">
            California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA)
          </p>
          <p>
            This Addendum applies solely to residents of the State of California and supplements the
            Privacy Policy above. It is provided pursuant to the California Consumer Privacy Act of
            2018, as amended by the California Privacy Rights Act of 2020 (collectively,
            "CCPA/CPRA"). Terms not defined in this Addendum have the meanings ascribed to them in
            the main Privacy Policy.
          </p>

          <h3 className="font-display text-xl">A.1 Categories of Personal Information Collected</h3>
          <p>
            In the preceding twelve (12) months, we have collected the following categories of
            personal information as defined by the CCPA/CPRA:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Identifiers, including name and email address (coaches and Parents); first name
              (Athletes)
            </li>
            <li>
              Internet or other electronic network activity information, including usage data and
              diagnostic information collected automatically
            </li>
            <li>
              Inferences drawn from usage data used to understand aggregate product usage patterns
            </li>
          </ul>
          <p>
            We do not collect Social Security numbers, financial information, precise geolocation
            data, biometric identifiers, health information, or characteristics of protected
            classifications from any user.
          </p>

          <h3 className="font-display text-xl">A.2 Purposes for Collection</h3>
          <p>
            We collect the categories of personal information identified above for the business and
            commercial purposes described in Section 3 of the Privacy Policy.
          </p>

          <h3 className="font-display text-xl">A.3 Disclosure of Personal Information</h3>
          <p>
            In the preceding twelve (12) months, we have disclosed personal information to the
            categories of third parties identified in Section 4.2 of the Privacy Policy for the
            operational purposes described therein. We have not sold or shared personal information
            as those terms are defined under the CCPA/CPRA.
          </p>

          <h3 className="font-display text-xl">A.4 No Sale or Sharing of Personal Information</h3>
          <p>
            We do not sell personal information. We do not share personal information with third
            parties for cross-context behavioral advertising. California residents therefore have no
            opt-out right with respect to a sale or sharing of personal information because no such
            sale or sharing occurs.
          </p>

          <h3 className="font-display text-xl">A.5 California Privacy Rights</h3>
          <p>
            Subject to verification of identity and applicable exceptions, California residents have
            the following rights under the CCPA/CPRA:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Right to Know:</strong> The right to request disclosure of the categories and
              specific pieces of personal information we have collected about you, the sources of
              that information, the purposes for which it was collected, and the categories of third
              parties to whom it was disclosed.
            </li>
            <li>
              <strong>Right to Delete:</strong> The right to request deletion of personal
              information we have collected about you, subject to applicable exceptions.
            </li>
            <li>
              <strong>Right to Correct:</strong> The right to request correction of inaccurate
              personal information we maintain about you.
            </li>
            <li>
              <strong>Right to Portability:</strong> The right to receive personal information in a
              portable, readily usable format.
            </li>
            <li>
              <strong>Right to Non-Discrimination:</strong> The right not to receive discriminatory
              treatment for exercising any of the above rights.
            </li>
          </ul>

          <h3 className="font-display text-xl">A.6 Submitting a Request</h3>
          <p>
            California residents may submit requests to exercise their CCPA/CPRA rights by
            contacting us at support@gradussports.com. We will verify your identity before
            processing any request. We will respond to verifiable requests within the timeframe
            required by applicable law. We may deny requests in whole or in part as permitted by
            law.
          </p>

          <h3 className="font-display text-xl">A.7 Authorized Agents</h3>
          <p>
            A California resident may designate an authorized agent to submit a CCPA/CPRA request on
            their behalf. We may require the authorized agent to provide proof of written
            authorization and may require the California resident to verify their identity directly
            with us.
          </p>

          <h3 className="font-display text-xl">A.8 Sensitive Personal Information</h3>
          <p>
            We do not collect or process sensitive personal information as defined under the
            CCPA/CPRA beyond what is necessary to provide the Service. We do not use or disclose
            sensitive personal information for purposes that would require us to offer a right to
            limit its use under California law.
          </p>

          <h3 className="font-display text-xl">A.9 Retention</h3>
          <p>
            We retain each category of personal information for as long as reasonably necessary for
            the purposes described in Section 7 of the Privacy Policy and as required by applicable
            law.
          </p>

          <h3 className="font-display text-xl">A.10 Contact for California Inquiries</h3>
          <p>
            California residents with questions or complaints regarding this Addendum or our privacy
            practices may contact us at support@gradussports.com.
          </p>
        </section>
      </article>
    </div>
  );
}

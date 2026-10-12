# Gradus written information security program

**Status:** first draft, 2026-10-03, written from the codebase and the vendor set as they stand. Internal document, required by the amended COPPA Rule (16 CFR 312.8): an operator must establish, implement and maintain a written program with safeguards appropriate to the sensitivity of the children's information it holds and to its own size. Decision #44 (Mariah, 2026-10-03): Mariah drafts and owns it without outside counsel at this stage.

**Program coordinator:** Mariah Gillespie, Gradus Sports, Inc. **Annual review date:** November 1 (first review 2026-11-01). **Change log:** at the end of this file.

---

## 1. Scope

Every system that stores or processes personal information of Gradus users, with the information of athletes under 18 as the sensitive core: the web app at gradus.training, the native iOS app, the backend (database, storage, edge functions, email queue), the vendor accounts that run them, and the laptops and accounts used to administer them.

## 2. Information inventory

| Category | Where it lives | Sensitivity |
|---|---|---|
| Athlete identity (name, date of birth, username, account state) | Postgres `athletes` (Supabase, via Lovable Cloud) | Children's PI |
| Parent and coach identity (name, email, role) | `parent_profiles`, `coach_profiles`, `auth.users` | PI |
| Messages (text; coach voice notes in the `voice-notes` bucket, transcripts) | `messages`, `message_rooms`, Supabase Storage | Children's PI (text) |
| Practice logs, goals, plans, session feedback | `plan_sessions`, `athlete_goals`, plan tables | Children's PI |
| Parent adult-verification result (when, provider, transaction ref) | `parent_profiles` columns | PI, compliance evidence |
| Consent ledger | `guardian_consents` | Compliance evidence |
| Webhook receipts, deletion tombstones | `webhook_receipts`, `deleted_accounts` | Low (ids, email hash) |
| Usage events (minors de-identified at write time) | `analytics_events` | Low for minors, PI for adults |
| Push device tokens | `device_tokens` | Identifier |
| Billing (coaches only) | Stripe; subscription state in `coach_profiles` | Financial, adults only |
| Secrets (database service key, APNs and Sign in with Apple keys, KWS credentials, cron key) | Lovable Cloud secrets, bound at runtime | Critical |

Not held: card numbers (Stripe, and Kids Web Services on its own pages), Social Security digits (Kids Web Services/Veratad), audio from athletes under 18, device location, government IDs.

## 3. Roles

- **Coordinator (Mariah):** owns this program, the risk assessment, vendor files, incident response, and the annual review.
- **Engineering (Mariah with AI-assisted development):** every change ships through a pull request on GitHub with CI (web: typecheck, lint, tests; iOS: build and test, contract sync check). No direct pushes to `main`.
- **Vendors:** process data under their published terms and data-processing agreements (section 7).

## 4. Risk assessment

Performed at adoption and every November 1, or after a material change (new vendor, new data category, incident). Current assessment:

| Risk | Likelihood | Impact | Controls (section 5) | Residual |
|---|---|---|---|---|
| Database service-role key leaks (client bundle, repo, logs) | Low | Critical | 5.1, 5.2, 5.6 | Low |
| A client bypasses row-level security to read another family's data | Low | High | 5.1 (RLS on every table, column-protection triggers) | Low |
| Forged provider callback marks a parent verified or pauses an athlete | Low | High | 5.3 (HMAC with timestamp window; JWS against pinned Apple roots) | Low |
| Credential stuffing or bot sign-ups | Medium | Medium | 5.4 (Turnstile, rate limits, App Attest on iOS) | Low |
| A minor is messaged without an adult present | Low | High | Room rule in server functions (PRD §6.13 C), text-only minors, parent pause | Low |
| Vendor breach (Supabase, Lovable, Cloudflare, Epic, Apple, Google) | Low | High | 5.5 vendor assurances; 6 incident response | Medium (outside our control) |
| Laptop or admin-account compromise | Low | Critical | 5.2 (MFA on every portal, device encryption, screen lock) | Low |
| Data kept longer than needed | Medium | Medium | Retention policy and its sweeps (`docs/legal/retention-policy.md`) | Low |
| Lost backups or no point-in-time recovery | Low | High | 5.7 (provider backups; confirm PITR setting annually) | Medium until confirmed |

## 5. Safeguards

### 5.1 Access control in the application
- Postgres row-level security is enabled on every table; the client uses the anon key under the signed-in user's JWT. New tables created for the consent backbone, app-store bindings and analytics have **no client policies at all**; only server functions with the service-role key write them.
- Columns a client must never set (billing state, parent verification, athlete account state) are guarded by `BEFORE INSERT OR UPDATE` triggers that admit only `is_service_caller()`.
- Server functions authenticate the caller (`requireSupabaseAuth`), then check ownership before any read or write; the `/api/v1` routes carry the same checks plus App Attest where the client is the iOS app.
- Admin tools (`/admin/*`) are limited to an allow-list (`admin_allowlist`) and never expose secrets.

### 5.2 Accounts and secrets
- Secrets live in Lovable Cloud and bind at runtime; none are committed. The service-role key exists only server-side; `.env.local` on development machines is git-ignored.
- MFA is on for: Lovable, Supabase (via Lovable), GitHub, Apple Developer and App Store Connect, Epic Developer Portal (Kids Web Services), Google Workspace, Stripe, Cloudflare. *Verify each at the annual review and tick the list in section 9.*
- Rotation: KWS secrets rotate in the Epic portal with an overlap window; the code accepts the current and previous secret (`KWS_*_PREVIOUS`). APNs and Sign in with Apple keys rotate by issuing a new key in the Apple portal and replacing the Lovable secret. The service-role key rotates through Supabase; every hook using it is updated the same day.
- Laptops: full-disk encryption (FileVault), screen lock, OS updates current.

### 5.3 Integrity of provider callbacks
- Kids Web Services: `x-kws-signature` HMAC-SHA256 over `timestamp.rawBody`, compared in constant time against every held secret, replays older than 24 hours refused; the Verification Response redirect checked the same way over `status:externalPayload`. Idempotent on transaction id (`webhook_receipts`).
- App Store Server Notifications V2: the JWS is verified against Apple's pinned Root CA G3 with the Worldwide Developer Relations and receipt-signer marker OIDs; idempotent on `notificationUUID`.
- Stripe: signed webhooks per Stripe's scheme.
- Cron hooks: callable only with the service-role key in the `apikey` header (`cronKeyMatches`).

### 5.4 Abuse resistance
- Cloudflare Turnstile on sign-in and registration; per-route rate limits (for example the account-recovery endpoint: 10 then 429); App Attest on iOS API calls; KWS's own send-email limit (10 per hour per parent).
- Upload rules: PDFs only for coach resources, images and video by public link; minors cannot upload audio. Since 2026-10-11 every coach PDF is checked on the server before athletes or parents see it (`resource-file-check.server.ts`, no AI or outside service): a PDF with any embedded picture, or one that can't be read with confidence (secured, damaged, too large), is held until a person releases it in Admin → Uploads to review (support@gradussports.com is emailed); a file that isn't a PDF is deleted. Uploads go only through server-signed links, and stored files no resource points at are swept daily (migration 20261011150000).

### 5.5 Transmission and storage
- TLS everywhere (Cloudflare at the edge; HTTPS-only universal links). No certificate pinning in the iOS app by decision (Cloudflare rotates certificates); a CAA record restricts issuance instead.
- Encryption at rest is provided by Supabase and Supabase Storage per their terms. *Confirm the current statement at the annual review.*
- Children's data is minimized at the source where possible: analytics for minors are written without identifiers and with club or region only above a ten-athlete floor; webhook receipts drop the parent's email.

### 5.6 Change management and code safety
- All code changes via pull request with CI; adversarial review on sensitive changes (consent, billing, webhooks) before merge; no force-pushes to `main`.
- Dependencies updated through the normal PR flow; `bun`/Swift package lockfiles committed.
- Logs never carry secrets or card data; the error digest hook emails failures to the team without payload bodies.

### 5.7 Availability and recovery
- Supabase automated backups per the project's plan; *confirm point-in-time recovery is enabled and record the retention window here at the first annual review.*
- Lovable production deploys are manual (Publish), so a bad build can be held back; secrets bind without a rebuild.
- KWS status page subscribed (kidswebservices.statuspage.io); Apple System Status and Supabase status watched during incidents.

## 6. Incident response

1. **Detect.** Sources: error digest email, Lovable Cloud logs, Supabase dashboard, provider notices, a report to support@gradussports.com (answered within one business day).
2. **Contain.** Rotate any secret that may be exposed (section 5.2); disable the affected route or flip the relevant switch (`API_V1_ENABLED`, `PARENT_VERIFICATION_REQUIRED`) if needed; preserve logs.
3. **Assess.** What data, whose, how many, over what period; whether children's data is involved.
4. **Notify.** Affected users and, for minors, their parents, without unreasonable delay; state attorneys general and consumers as state breach laws require (most states: 30–60 days, lower thresholds for minors' data); Apple if the App Store listing or entitlements are affected; Epic if KWS credentials were exposed. Keep a written record of every notification.
5. **Learn.** A short blameless write-up in `docs/legal/incidents/` within two weeks, with the control change that follows.

## 7. Vendor management

The rule requires reasonable steps to ensure that anyone receiving children's information can keep it confidential and secure, in writing. For each vendor, file the governing terms or data-processing agreement, the date accepted, and the data it covers, in the folder named in section 9.

| Vendor | Data | Agreement to file |
|---|---|---|
| Supabase (via Lovable Cloud) | Database and storage: all categories | Supabase DPA / terms via Lovable |
| Lovable Cloud | Hosting, secrets, edge functions, AI gateway | Lovable terms and DPA |
| Cloudflare | Edge, TLS, Turnstile | Cloudflare terms / DPA |
| Apple | Push delivery, Sign in with Apple, App Store notifications | Apple Developer Program License Agreement |
| Epic Games (Kids Web Services) | Parent email, verification result; card/SSN handled by its processors Stripe and Veratad | KWS General Terms (accepted 2026-09-25) |
| Stripe | Coach billing; KWS card checks under KWS's account | Stripe Services Agreement |
| Google LLC | Workspace mail; Gemini inference for coach-side features | Workspace terms, Cloud/AI terms |
| ElevenLabs | Speech-to-text: coach voice notes, coach and adult-athlete plans by voice; never audio from athletes under 18 (PRD #48). ElevenLabs keeps speech-to-text audio and transcripts under its own policy unless Enterprise zero retention is on | ElevenLabs terms, privacy policy and DPA (business customers) |
| OpenAI (through the Lovable AI gateway) | Embeddings for Ask Gradus (text only, adults) | Lovable AI gateway terms |
| Anthropic, PBC (Claude API, direct) | Coach move drafts (web #224, PRD #53): only what the coach types about the move (name, sport, hint, partly written fields) and Gradus library examples; no account identifiers or athlete data; Claude may run web searches for the move name | Anthropic Commercial Terms of Service and DPA |
| GitHub, Xcode Cloud | Source and build | Standard terms |

## 8. Testing and monitoring

- **Continuous:** CI on every PR; webhook signature tests; RLS covered by server tests and the SMOKE precheck after migrations.
- **Quarterly (Feb, May, Aug, Nov 1):** review who has access to each portal; check the MFA list; read the error digest trend; confirm the retention sweeps ran (`[api] consent-retention` log lines).
- **Annually (Nov 1):** this risk assessment; a dependency audit; confirm backups/PITR; re-read the privacy policy against the information inventory; update this document.

## 9. Evidence and filing

Folder: Google Drive → Gradus → Legal → Security program (create at first review). Contents: this document's dated versions; the vendor agreements in section 7 (**decision #45: filed as part of the PRD wrap-up before submission**); the MFA checklist; backup confirmation; incident write-ups.

## 10. Change log

| Date | Change | By |
|---|---|---|
| 2026-10-03 | First draft from the codebase and vendor set | Mariah, with Claude |
| 2026-10-11 | Anthropic added as a vendor (coach move drafts) | Mariah, with Claude |

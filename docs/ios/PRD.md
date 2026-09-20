# Gradus for iOS — Product Requirements Document

**Status:** Draft v1 for review · **Owner:** Mariah Gillespie · **Author:** Claude Code · **Date:** 2026-09-04 · **Amended:** 2026-09-19 (native-only release and the pre-QA gate, §10.6) · 2026-09-20 (athlete learning loop and grounded Ask Gradus, §6.7 and §10.7)
**Repos:** backend and web `mariah-gill/gradus-coach-start` · native app `mariah-gill/gradus-ios` (to be created) · **Web app:** https://gradus.training · **Bundle ID:** `training.gradus.app`

This document specifies the native Swift rebuild of the Gradus progressive web app for iPhone. It is written to be executed by Claude Code with Mariah reviewing, so it is deliberately concrete: it names the endpoints, screens, data, and guarantees, and it records the decisions already made so future sessions do not re-litigate them.

**How to read it.** Sections 1–5 are the "why" and the rules. Section 6 is the architecture, including the answers to *how do web and iOS share one backend* and *how do we avoid disrupting current users*. Section 7 is the feature inventory with priorities. Sections 8–9 are design and engineering standards. Section 10 is the milestone sequence. Appendices map every web server function to an API endpoint and every web route to an iOS screen.

**Contents**

0. [Decision log](#0-decision-log) · 1. [Summary](#1-summary) · 2. [Goals and success metrics](#2-goals-and-success-metrics) · 3. [Users and roles](#3-users-and-roles) · 4. [Non-negotiable constraints](#4-non-negotiable-constraints) · 5. [Current system snapshot](#5-current-system-snapshot)
6. [Architecture](#6-architecture): 6.1 one backend · 6.2 API v1 · 6.3 direct Supabase use · 6.4 authentication · 6.5 offline and sync · 6.6 realtime and push · 6.7 AI and voice · 6.8 payments · 6.9 Live Board · 6.10 deep links · 6.11 security and privacy
7. [Feature requirements](#7-feature-requirements) · 8. [Design system on iOS](#8-design-system-on-ios) · 9. [Engineering standards](#9-engineering-standards) · 10. [Milestones and delivery](#10-milestones-and-delivery) · 11. [Risks and dependencies](#11-risks-and-dependencies) · 12. [Open decisions](#12-open-decisions)
Appendices: [A · endpoint map](#appendix-a--server-function--api-v1-endpoint-map) · [B · tables](#appendix-b--tables-by-domain-and-what-ios-caches) · [C · route → screen](#appendix-c--web-route--ios-screen) · [D · App Store checklist](#appendix-d--app-store-submission-checklist) · [E · glossary](#appendix-e--glossary) · [F · work packages](#appendix-f--work-packages-scope-reference)

---

## 0. Decision log

Decisions confirmed with Mariah on 2026-09-04. Treat these as settled.

| # | Decision | Choice |
|---|---|---|
| 1 | Relationship to the Capacitor shell | **Superseded 2026-09-19 (Mariah):** the Capacitor iOS shell never ships. The native app is the first App Store release, versioned **1.0** (§9.1, §10.5). Whether the Capacitor Android shell ships at all is reopened under §12 #14. The web app stays for the internal admin panel and org admins. *Original 2026-09-04 decision, for the record:* the shell ships as 1.0 for store presence and the native app replaces it as 2.0 under the same bundle ID; the Android shell follows and a Kotlin rebuild replaces it. |
| 2 | Roles in v1 | **Coach, Parent, Athlete** (including adult self-managed athletes). Org admin and internal admin stay web-only. |
| 3 | Native release scope | **Full feature parity in the first native release**, versioned **1.0** since 2026-09-19 (2.0 while a shell was planned). No partial native launch. The P0/P1 tags in §7 order the build, not the releases. |
| 4 | Live Board | **In native 2.0**, built in the first (P0) wave, with Live Activities. |
| 5 | Backend | One backend shared by web and iOS: the existing Lovable Cloud (Supabase) project plus the server logic in this repo, exposed to iOS through a versioned JSON API added to this repo. No data migration. See §6. |
| 6 | Web sunset | Once **both** native apps (iOS, then Android in Kotlin) are live with feature parity, the web app is sunset for coaches, parents, and athletes, and product development moves from Lovable to Claude Code. Until then, **no interruption or degradation of the web experience is acceptable.** See §4 and §10.4. |
| 7 | Platform | iOS 18 minimum, iPhone-first with adaptive iPad layouts, no Apple Watch in v1. |
| 8 | Payments | **No In-App Purchase.** Subscriptions are purchased on the web. The app shows entitlement and, where Apple's rules allow, links out. See §6.8. |
| 9 | Offline | **Yes.** Offline-first for plans, schedule, sessions, and message drafts, with background sync. See §6.5. |
| 10 | Design | Keep Gradus typography and color tokens; adopt native navigation and gestures. See §8. |
| 11 | Team and format | Claude Code builds it with Mariah reviewing once a day. PRD lives in the repo as Markdown. First TestFlight as soon as App Store Connect is set up (enrollment approved 2026-09-19); the pre-QA gate in §10.6 comes first. |
| 12 | Pace | **Milestone-driven, no time estimates.** One daytime Claude Code stream on iOS plus overnight backend runs; the next milestone starts when the current one is done (§10.1). |
| 13 | Repositories | The native Swift app lives in a **new repo, `mariah-gill/gradus-ios`**. The backend API stays in `gradus-coach-start` because it runs in the Worker Lovable deploys. The OpenAPI document is the contract between them, pinned by commit. Kotlin later gets `gradus-android`. |
| 14 | Athlete learning loop in 1.0 | **2026-09-20 (Mariah):** the site's promise that Gradus "learns each athlete's pace and seasonal trends" and "digests competition results into the next plan" becomes product, not copy. The data capture (skill events, level history), the flow-state label fix, and a longitudinal athlete profile that feeds the existing prompts all ship **before the native 1.0 submission** (§10.7). A *trained* per-athlete pace model is post-launch, once a season of real events exists to train on. |
| 15 | Grounded Ask Gradus | **2026-09-20 (Mariah):** Ask Gradus answers from a curated, cited corpus (retrieval-augmented) instead of general model knowledge: The Athlete Survivors' Assist materials, the SafeSport Code and MAAPP, the rulebooks for each supported sport, the coaching and athlete-development sources Mariah picks (§12 #15), and each coach's own uploaded resources, scoped to that coach's athletes. Gates 1.0 (§10.7). |
| 16 | Ask Gradus fallback | **2026-09-20 (Mariah):** when the corpus does not cover a question, answer from general model knowledge and **say so plainly** in the answer. Safety topics never fall back: they route to the Safe Sport panel content. |
| 17 | Coach "why" prompt | **2026-09-20 (Mariah):** when a coach benches a plan or removes a move, the one-tap reason prompt (landed it / parking it / changed direction) is **skippable**. Only answered prompts become labeled skill events; the rest are inferred with a low-confidence flag. Coaches are never blocked. |
| 18 | Canonical flow-state labels | **2026-09-20 (Mariah):** **Frustrated / Pushing / Steady / Locked in / Flowing** are the labels for every user, every screen, and every prompt. The coach's AI summary had its own mastery-flavored scale for the same index; web PR #127 removes it. |

---

## 1. Summary

Gradus is a coaching platform for the time between lessons: coaches write practice plans, athletes and parents run them with a session timer and log how practice felt, everyone messages in one shared room, and coaches get AI briefings before each lesson. A public Live Board shows who is on the ice, latest scores, and who is up next at U.S. Figure Skating competitions.

Today Gradus ships as a server-rendered React web app (TanStack Start on Cloudflare Workers, Supabase behind it, built in Lovable), installable as a PWA, with a Capacitor shell prepared for the stores. That shell was always a compromise: it depends on a live network connection for every screen, cannot run a session timer reliably in the background, cannot show a Live Activity, and offers nothing a rink with poor reception can use.

This project rebuilds the coach, parent, and athlete experience as a native SwiftUI app while **keeping exactly one backend**. The web app is not forked, migrated, or changed in any user-visible way during the build. iOS reaches the same database, the same auth users, the same storage buckets, and the same server logic through a new versioned API that lives in the web repository and deploys through the same Lovable publish the web uses today. The Swift app itself lives in its own repository, `gradus-ios`, and consumes that API through a generated client. When the Kotlin app follows, it consumes the same API from `gradus-android`.

**Store presence.** *Amended 2026-09-19:* the native app is the first store release, version 1.0. The earlier plan to ship the Capacitor shell as 1.0 and replace it with native 2.0 is dropped; §10.5 stays only as the record of that decision. No user ever migrates from a shell.

**What changes for users:** the app works offline, the session timer survives the phone locking, messages and plan assignments arrive as push notifications, Face ID unlocks the app, the Live Board shows up in the Dynamic Island, and everything feels like an iPhone app rather than a web page. **What does not change:** their account, their data, their coach connections, their subscription, and the web app they use today.

### Non-goals

- Android, watchOS, macOS (Catalyst), or visionOS.
- Org admin or internal admin features on iOS.
- Purchasing subscriptions in-app.
- Migrating off Lovable Cloud or changing the Supabase project. (Documented as a possible later project in §11.)
- Rewriting AI prompts, the IJS scraper, the email system, Stripe webhooks, or any server behavior that is not required for the iOS client. *Amended 2026-09-20:* §6.7 and §10.7 now change the Ask Gradus, plan-draft, athlete-summary, and briefing prompts on purpose, under the §4.1 rules and with the web receiving the same improved answers. The rest of this bullet stands.
- Redesigning the product. Screens may be reorganized to fit iOS idioms, but the information architecture, copy, and flows are ported, not reinvented.

---

## 2. Goals and success metrics

### Product goals

1. **A coach can run their week from the rink.** Roster, today's lessons, the athlete's plan, the pre-lesson briefing, and messaging all work with no or intermittent connectivity.
2. **A practice session is effortless to log.** Start the timer, lock the phone, come back, end, rate the flow state. Never lose a session.
3. **Nothing important is missed.** New messages, plan assignments, lesson wrap-up prompts, and Live Board moments arrive as notifications.
4. **The Live Board is the best way to follow a competition on a phone.** Scan a QR code at the rink, follow your skaters, watch the Dynamic Island.
5. **Feature parity with the web app for coaches, parents, and athletes**, so the web can be sunset for those roles.
6. **Gradus learns each athlete and answers from vetted sources** *(added 2026-09-20)*. Every plan draft, briefing, and athlete summary reads a longitudinal profile of that athlete built from what coaches, athletes, parents, and judges have already recorded; Ask Gradus answers from a cited corpus. See §6.7.

### Success metrics (measure from launch)

| Metric | Target |
|---|---|
| Crash-free sessions | ≥ 99.5% |
| Cold launch to interactive (cached account) | < 1.5 s on iPhone 12 |
| Sessions started offline that sync successfully | ≥ 99% |
| Message send → recipient push delivered (p50) | < 5 s |
| Live Board data age shown to a viewer (p50) | ≤ 45 s behind IJS |
| App Store rating after 60 days | ≥ 4.6 |
| Web weekly actives among coaches/parents/athletes 90 days after launch | trending to zero, gating the sunset (§10.4) |
| Ask Gradus answers that cite at least one corpus source *(added 2026-09-20)* | ≥ 80% of answers; the rest carry the "not from Gradus sources" label |
| Bench and move-removal prompts a coach answers rather than skips *(added 2026-09-20)* | ≥ 60% |
| Athletes with at least one labeled or protocol-derived skill event 60 days after launch *(added 2026-09-20)* | ≥ 70% of athletes with an active plan |

### Guardrails (must not regress during the build)

- Web error rate in the admin errors dashboard.
- Web sign-in success rate.
- Email deliverability health.
- Web p75 page load, measured before Phase 0 begins and re-checked after every backend publish.

---

## 3. Users and roles

Gradus resolves a signed-in user's role server-side from which profile rows exist (see `getMyRole`): coach if a coach profile exists, else parent, else athlete, else org admin. The iOS app uses the same resolution through the API and never infers role client-side.

| Role | Who | In native 2.0 | Notes |
|---|---|---|---|
| **Coach** | Private-lesson coaches, mostly figure skating; also multi-sport and strength & conditioning | Yes | Subscription tiers: Coach, Coach Pro, Club (via organization). Founding Coaches (onboarded before 2026-11-01) are free for life. |
| **Parent / guardian** | Parent of a minor athlete; up to three guardians per athlete on the Team plan | Yes | Creates athletes, links coaches, runs sessions for young athletes, manages the athlete's login. |
| **Athlete (minor)** | Created by a parent, logs in with a **username** (no email) | Yes | Restricted messaging persona, Safe Sport resources, youth-safe Ask Gradus. |
| **Athlete (adult, self-managed)** | Signs up directly, links coaches themselves | Yes | Has an invite code for coaches; can manage own schedules and goals. |
| Org admin | Club purchaser or director | **No** (web) | Roster of club coaches, coach invites, templates, calendar. |
| Internal admin | Gradus staff | **No** (web) | 30 admin routes: users, billing, emails, errors, impersonation, competitions, promo codes. |

Minors: the app never markets to children and does not enroll in Apple's Kids Category (it forbids external links and third-party analytics). Athlete birthdates are collected by the parent; the app must surface age-appropriate personas exactly as the web does.

---

## 4. Non-negotiable constraints

These are the rules that protect current web users. Every backend pull request is checked against them before merge, and they are restated in the CI checklist (§9.6).

### 4.1 Zero-disruption guarantees for the web app

1. **No change to web-facing server functions.** Every `createServerFn` keeps its name, input schema, return shape, and behavior. Refactors that extract shared logic must be behavior-preserving and are verified by `bun run typecheck`, `bun run lint`, `bun run build`, and a manual smoke pass in Lovable preview before publish.
2. **Additive database changes only** until the web is sunset. New tables, new nullable columns, new indexes, new RLS policies, new functions. No renames, drops, type changes, or tightened constraints on existing tables. Every new `public` table ships with GRANTs and RLS in the same migration (existing repo rule).
3. **No change to Supabase Auth settings the web depends on.** Captcha protection stays on. The Lovable-managed Google provider stays as is. Email templates stay as is. iOS gets its own auth endpoints (§6.4) rather than changing shared settings.
4. **The API is additive and isolated.** It lives under `src/routes/api/v1/`, shares nothing with the web client bundle, and has a server-side kill switch (`API_V1_ENABLED`) that disables it without a redeploy of anything else.
5. **Same deploy path, smaller steps.** Backend changes ship through the existing Lovable publish, in small independently revertible PRs, never bundled with unrelated web work. Migrations that touch shared tables are applied first in Lovable preview, then published in US evening hours.
6. **Web bundle budget unchanged.** No new client-side dependencies for the web. New server code lives in `.server.ts` files, which are never reachable from a client import chain.
7. **Push is best-effort.** A push-send failure never fails the underlying action (message send, plan activation).
8. **Observe after every publish.** The admin errors dashboard and email health page are checked after each backend publish; a regression triggers a revert first and a diagnosis second.
9. **Sunset is a separate decision.** Until the criteria in §10.4 are met and Mariah decides, the web app for all roles is fully supported, including bug fixes.
10. **No credential or key moves.** The Supabase publishable key, service role key, Stripe keys, and AI keys stay where they are. iOS only ever holds the publishable key.
11. **Migration files that reach `main` through GitHub are NOT applied by a Lovable publish.** Confirmed 2026-09-05: after two publishes the SQL precheck returned NULL for every `/api/v1` relation and the rate limiter silently allowed every request; Mariah asked Lovable to apply the pending migrations (Lovable recorded it as the commit "Applied pending migrations"); the precheck then returned all of them and the limiter enforced its limit. Every backend PR that adds a migration therefore ends with two steps after merge: ask Lovable to apply pending migrations, then run the precheck in `docs/api/SMOKE.md`. Nothing that reads a new relation is enabled before both are done. Code guarding public write endpoints fails closed and logs when its table is unreachable.
12. **Service-role-only database functions revoke EXECUTE from `anon` and `authenticated` explicitly.** Supabase's default privileges grant EXECUTE on every new function directly to those roles, so `REVOKE ... FROM PUBLIC` alone leaves it callable by anyone holding the public key (found 2026-09-05: `find_confirmed_user_by_email` answered anonymous PostgREST calls with real user ids). Every such migration ends with `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` and is verified by an anonymous call to `/rest/v1/rpc/<fn>` returning permission denied.
13. **Billing and membership columns on profile tables are server-only.** `coach_profiles` (entitlement, subscription, Stripe, founding, free-access, trial, promo, organization, org-admin) and `parent_profiles` (subscription, Stripe, promo, team seats) are guarded by `BEFORE INSERT OR UPDATE` triggers that reject changes unless the caller is the service role (migration `20260905200000_protect_billing_columns`). Row policies cannot restrict columns, so a user could otherwise PATCH their own row through PostgREST (Lovable schema review, 2026-09-05). Server functions write these columns through the admin client only; never through `context.supabase`. Verified with the guard check in `docs/api/SMOKE.md`.

### 4.2 Platform constraints (facts, verified 2026-09-04)

- **Supabase Auth captcha.** The project has Turnstile captcha enabled at the Auth layer (the web passes `captchaToken` into `signInWithPassword`, `signUp`, and `resetPasswordForEmail`). Supabase Auth **skips captcha** when the request uses the `id_token`, `refresh_token`, or `pkce` grant, or when it carries service-role credentials. It **enforces** captcha on the password grant, sign-up, and recovery. This shapes §6.4.
- **No direct Supabase dashboard.** The backend is a Lovable Cloud project. Lovable Cloud exposes a SQL editor, table views, RLS review, secrets, edge functions with schedules and database triggers, and auth settings including Google sign-in (managed by Lovable or with your own credentials). It does **not** expose a Sign in with Apple provider. Anything that needs a provider Lovable Cloud does not expose must be done in our own server code.
- **Google sign-in is brokered.** The web uses `@lovable.dev/cloud-auth-js`, which runs the OAuth dance on Lovable's broker and hands back Supabase tokens. That is a web redirect flow, not a native one.
- **Server logic depends on the service role.** 49 of 67 server-function files use the admin client. Row Level Security alone cannot power a native client; an API layer is required.
- **Cloudflare Workers can reach APNs.** Workers `fetch` speaks HTTP/2 and has WebCrypto for signing the APNs JWT, so the push sender can live in the existing Worker.
- **TLS certificates rotate.** gradus.training certificates are Cloudflare-managed and rotate roughly every 90 days. **Do not pin certificates** (see `docs` memory: ATS pinning decision). Use ATS defaults; add a CAA record at the DNS level instead.
- **Apple Developer enrollment** was approved on 2026-09-19 (D-U-N-S applied 2026-08-29). App Store Connect is not set up yet: no App ID, no APNs or Sign in with Apple keys, no Team ID in the project, no Xcode Cloud. Until those exist: no TestFlight, no push testing, no Sign in with Apple testing on a device, no Associated Domains. The account-side steps are listed in §10.6 and in gradus-ios `docs/enrollment-checklist.md`.

---

## 5. Current system snapshot

Measured on `main` at commit `e6b21f48` (2026-09-03).

| Measure | Count |
|---|---|
| Route files | 107 (31 coach/parent/athlete, 27 admin, 7 org-admin, 10 sign-up, 6 auth and layouts, 9 public and legal, 17 API, email, and dev) |
| Server functions (`createServerFn`) | 370 total; 293 in the 53 non-admin files (the rest are admin, email, impersonation, error tracking, and Turnstile) |
| Public tables | 75, with 341 RLS policies across 173 migrations |
| Lines of TypeScript | ~96,000 (routes 28k, components 25k, lib 35k) |
| Realtime channels | `messages` table via `postgres_changes` (room view and unread badge) |
| Storage buckets | `voice-notes` (private, room-participant RLS), `resource-pdfs` (signed URLs) |
| External services | Supabase, Stripe (subscriptions + billing portal), Lovable AI Gateway → Gemini 2.5 Flash / Gemini 3 Flash preview, ElevenLabs Scribe v2 (transcription), Cloudflare Turnstile, pg_cron → Worker hook routes, USFS IJS results pages (scraped) |
| Client-side platform code | `src/lib/native.ts`, `native-push.ts`, `native-biometric.ts` (Capacitor; inert on web) |

### What is reused as-is

Database schema and RLS; all server-side business logic (after being made callable from the API); Stripe integration; AI prompts and gateway; transcription; email system; IJS scraper and snapshot cache; invite code system; account deletion and message tombstoning; report/block system; terms versioning.

### What is rebuilt natively

Every screen for coach, parent, and athlete; navigation; auth UI; offline store and sync; push handling; Live Board presentation and Live Activities; voice capture and playback; camera capture for schedule import; PDF viewing; share sheets; haptics; biometric gate.

### What is added server-side

The `/api/v1` layer (§6.2); auth broker endpoints for Apple, Google, and password sign-in (§6.4); APNs sender and notification triggers (§6.6); idempotency and pagination support; OpenAPI spec generation; a small number of additive tables (`api_idempotency_keys`, `auth_identities`, `board_follows`, `live_activity_tokens`). *Added 2026-09-20 (§6.7):* the `vector` extension and the tables `athlete_skill_events`, `athlete_goals_history` (web PR #129), `knowledge_sources`, `knowledge_chunks`; a knowledge-ingestion path that runs inside the Worker; and a derived athlete profile that the existing prompts consume.

---

## 6. Architecture

### 6.1 One backend, two clients

```
                ┌──────────────────────────────────────────────────────────────┐
                │  Lovable Cloud (Supabase project sdqfaqxmdmujxqhwlqdi)        │
                │  Postgres + RLS · Auth (GoTrue) · Storage · Realtime · pg_cron│
                └───────────────▲──────────────────────────────▲───────────────┘
                                │ service role                 │ publishable key + user JWT
                                │                              │ (auth session, realtime,
                                │                              │  storage signed URLs)
┌───────────────────────────────┴───────────────┐              │
│  gradus.training  (Cloudflare Worker,          │              │
│  TanStack Start app in THIS repo)              │              │
│                                                │              │
│  ┌──────────────────┐   ┌───────────────────┐  │              │
│  │ Web UI (SSR+SPA) │   │ /api/v1/* (JSON)  │  │              │
│  │ server functions │   │ OpenAPI 3.1       │  │              │
│  └────────┬─────────┘   └─────────┬─────────┘  │              │
│           │  both call the same   │            │              │
│           └──────► src/lib/*.server.ts ◄───────┘            │
│                    (shared domain logic)                     │
│  Stripe · AI gateway · ElevenLabs · IJS scraper · APNs sender│
└───────────────────────────────▲──────────────────────────────┘
                                │ HTTPS, Bearer <Supabase access token>
             ┌──────────────────┴───────────────┐      ┌───────────────────────┐
             │  Web browser / PWA (unchanged)    │      │  Gradus for iOS (new)  │
             └──────────────────────────────────┘      │  later: Gradus Android │
                                                       └───────────┬───────────┘
                                                                   │
                                                                   └── direct to Supabase for auth session,
                                                                       realtime on messages, storage URLs
```

**Why this answers "how do web and mobile stay in sync."** There is one database, one set of auth users, one storage bucket set, and one copy of the business logic. The web reaches that logic through TanStack server functions; iOS reaches it through `/api/v1`. Both are thin transports over the same TypeScript functions, so a fix or a rule change lands in both clients the moment it is published. Nothing is copied, mirrored, or scheduled to sync, so nothing can drift.

**Why the API lives in this repo rather than in Supabase Edge Functions.** The logic already exists here in Node-flavored TypeScript with the service role, Stripe, AI, and transcription wired in. Wrapping it is days of work; porting ~290 functions to Deno edge functions is weeks, and it would require the web app to be re-pointed at the new functions, which is exactly the kind of change §4 forbids. Edge functions remain a good fit for database-triggered jobs (see push, §6.6) and are used where they are the simplest tool.

**Why this is the scalable long-term shape.** The API is versioned, transport-agnostic, and described by an OpenAPI document that generates the Swift client (and later the Kotlin client). When the web is sunset for the three roles, the TanStack app shrinks to the admin panel plus the API; if it is ever useful to split the API into its own Worker or service, clients do not change. If Gradus later takes ownership of its Supabase project (§11), the API is the only thing that needs re-pointing.

### 6.2 Backend API v1

**Location and deployment.** File routes under `src/routes/api/v1/**` in this repo, served by the same Worker at `https://gradus.training/api/v1/...`. Deployed by the existing Lovable publish. A `src/lib/api/` folder holds the shared plumbing (auth, errors, idempotency, OpenAPI registry).

**Implementation pattern (behavior-preserving).** For each domain file `src/lib/<domain>.functions.ts`:

1. Move each handler body into an exported function in `src/lib/<domain>.server.ts` (create if missing) with the signature `fn(ctx: ApiContext, input: Input): Promise<Output>`, where `ApiContext = { userId, supabase (user-scoped), admin (service role) }`. The zod input schema and the output type move with it and are exported.
2. The server function becomes a three-line wrapper: middleware → validate with the same schema → call the shared function. Its name, schema, and return type do not change.
3. The API route imports the same schema and function, validates the JSON body, calls it, and serializes the result. The route registers itself with the OpenAPI registry using the same schema.
4. Each domain is one PR, merged only when typecheck, lint, and build pass and the affected web screens have been smoke-tested in Lovable preview.

**Authentication.** `Authorization: Bearer <Supabase access token>`, verified exactly as `requireSupabaseAuth` does today (`auth.getClaims`). Public endpoints (Live Board, shared plan) are explicitly marked and rate-limited. Role checks happen inside the shared functions, as today.

**Request and response conventions.**

| Concern | Rule |
|---|---|
| Versioning | Path prefix `/api/v1`. Within v1 only additive changes (new optional fields, new endpoints). Breaking changes create `/api/v2`. |
| Client identification | `X-Gradus-Client: ios/1.4.0+87` header. `GET /api/v1/meta/client-policy` returns `minSupportedVersion` and an optional message so the app can force an update. |
| Content type | JSON in and out. Multipart for audio and images. Dates as ISO 8601 UTC strings. IDs as UUID strings. Money as integer cents plus currency. |
| Errors | `{"error": {"code": "roster_full", "message": "...", "details": {...}}}` with stable snake_case codes. Existing string-matched errors (for example the roster cap trigger's "Roster full:") are mapped to codes at the boundary. HTTP 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422 domain rule, 429 rate limited, 5xx server. |
| Idempotency | Creating POSTs (`messages`, `sessions`, `invoices`, `lesson-slots`, `plans`) accept an `Idempotency-Key` header. The server stores `(user_id, key) → response` in `api_idempotency_keys` for 24 hours and replays the stored response on retry. Required by the offline mutation queue. |
| Pagination | Cursor-based on unbounded lists: `?limit=50&cursor=<opaque>` returning `{ items, nextCursor }`. Applies to room messages (today capped at 500 in one call), plan sessions, invoices, admin-style lists. Small per-user collections (roster, plans, moves) return whole with an `ETag`; clients send `If-None-Match` and get `304`. |
| Rate limiting | DB-backed sliding window (same pattern as the existing `record_invite_lookup_attempt` RPC) on auth endpoints, invite lookups, AI endpoints, and public board endpoints. Keyed by IP and, when authenticated, by user. |
| Kill switch | `API_V1_ENABLED` environment variable. When false every `/api/v1` route returns 503 with a friendly message and the app shows its offline cache. |
| Documentation | OpenAPI 3.1 generated from the zod schemas at build time to `docs/api/openapi.json` in the web repo. CI fails if the committed file is out of date. The `gradus-ios` repo vendors that file at a pinned web-repo commit and generates the Swift client with `swift-openapi-generator`. |

**Composite endpoints.** A few endpoints exist only for the client's benefit and aggregate several server functions, to avoid launch-time request storms on mobile networks: `GET /api/v1/me` (role, profile summary, onboarding state, entitlement, terms status, guardian status, feature flags, unread count) and `GET /api/v1/coach/home?week=` (roster, week occurrences, practice summaries, pending wrap-ups, pending post-event items).

The full mapping from server functions to endpoints is in Appendix A.

### 6.3 What iOS talks to Supabase about directly

Only the parts where the Supabase SDK is the right tool and RLS already governs access:

| Use | How | Why direct |
|---|---|---|
| Session storage and refresh | `supabase-swift` Auth with Keychain storage; `refresh_token` grant is captcha-exempt | The SDK handles expiry, refresh, and token rotation correctly. |
| Realtime messages | `postgres_changes` on `public.messages` filtered by room, same as the web's `room:<id>` channel; plus an unread listener | Realtime is already published and RLS-scoped to participants. |
| Voice note upload/playback | Upload to `voice-notes/<roomId>/<uuid>.m4a`; download via signed URL | Bucket policies already scope to room participants; avoids proxying audio through the Worker. |
| Resource PDFs | Signed URL from the API, then direct download | Same as web. |

Everything else goes through the API. The app never issues ad-hoc table queries; that keeps the RLS surface the web already relies on unchanged and keeps business rules in one place.

### 6.4 Authentication and account

**Requirement.** Because the web offers Google sign-in, App Store Guideline 4.8 requires the iOS app to offer Sign in with Apple (or an equivalent privacy-preserving option). Sign in with Apple is therefore **P0** and must exist before the first App Store submission.

**Constraint recap.** No Apple provider can be configured in Lovable Cloud. Captcha blocks direct password sign-in from a native client. Google is brokered by Lovable's web flow.

**Design: the API is the identity broker.** iOS never depends on provider settings that Lovable Cloud does not expose. The Worker already holds the service role, which both bypasses captcha and can mint sessions. The same broker gives the Capacitor 1.0 shell its Sign in with Apple: a Capacitor plugin (`@capacitor-community/apple-sign-in`) shows the native Apple sheet, and the web code posts the identity token to `/auth/apple` and calls `setSession`, exactly as the native app does.

| Flow | Client | Server (`/api/v1/auth/*`) |
|---|---|---|
| **Sign in with Apple** | `ASAuthorizationController` with a hashed nonce; receive identity token, user identifier, and (first time only) name and email | `POST /auth/apple {identityToken, nonce, fullName?}` → verify JWT signature against Apple JWKS, check `aud == training.gradus.app` and nonce → look up `auth_identities(provider='apple', provider_sub)`; else match a confirmed user by email; else create the user via admin API with `email_confirm: true` → mint a session (admin `generateLink(type: magiclink)` then `verifyOtp` with the token hash using service-role credentials) → return `{access_token, refresh_token, expires_in, isNewUser}` → client calls `auth.setSession`. Handle Apple private-relay emails as normal emails. |
| **Google** | Native `GoogleSignIn` SDK (or `ASWebAuthenticationSession` with PKCE) → ID token | `POST /auth/google {idToken}` → verify against Google JWKS and the iOS client ID → same identity lookup and session mint. **Alternative** if Lovable Cloud's "your own credentials" Google setup exposes authorized client IDs: use `signInWithIdToken` directly (captcha-exempt). Decide during Phase 0 (§12). *2026-09-19:* the broker exists; on iOS the provider is a stub and the button is **hidden until `GOOGLE_IOS_CLIENT_ID` is configured** (Mariah's call). |
| **Email or username + password** | Native form | `POST /auth/password {identifier, password}` → if identifier has no `@`, resolve username to the synthetic email `athlete-<id>@users.gradus.training` (existing logic in `resolveAthleteLogin`) → call the GoTrue password grant with service-role `Authorization` (captcha-exempt) → return the session. Rate-limited per IP and per identifier; generic error on failure. |
| **Coach email sign-up** | Native form | `POST /auth/signup/coach {email, password, promoCode?, inviteCode?}` → admin create user honoring the project's email-confirmation setting → session mint if confirmation is off; otherwise return `confirmationRequired`. Verify the current setting in Lovable Cloud during Phase 0. |
| **Parent, minor athlete, adult athlete sign-up** | Native flows | Already server-side today (`startParentSignup`, `signupAthleteWithUsername`, `createSelfManagedAthlete`); exposed as-is under `/signup/*`. |
| **Forgot password** | Native form | `POST /auth/recover {email}` → `resetPasswordForEmail` with service-role credentials (captcha-exempt). The emailed link opens the existing web reset page in the P0 wave; the P1 wave opens the app via universal link and calls `auth.updateUser`. |
| **Change password / email** | Settings → Account & security | `auth.updateUser` directly through the SDK (authenticated, no captcha). |
| **Sign out** | Settings | `DELETE /devices/{token}` then `auth.signOut()`; clear local store and Keychain. |
| **Delete account** | Settings → Account & security | `GET /me/deletion-impact` then `DELETE /me` (existing logic including message tombstoning). Because Sign in with Apple is offered, the server must also **revoke the Apple token** (`POST https://appleid.apple.com/auth/revoke`) using the Sign in with Apple key. Needs the `.p8` from the developer account. |

**Session and device security.** Tokens live in the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Optional Face ID / Touch ID gate on launch and on return from background (mirrors today's `native-biometric.ts` semantics: a local convenience lock, not an auth mechanism). No token is ever logged or sent to any third party.

**Terms.** On every launch with a session, compare `termsVersion` from `/me` with `CURRENT_TERMS_VERSION` (currently `2026-06-29`); if stale, present a blocking acceptance sheet that calls `POST /me/terms/accept`. Signup screens include the same checkbox the web has.

**Account switching.** The local store is keyed by user id. Signing out wipes it. There is no multi-account mode in v1.

**Bot protection without Turnstile.** The API's auth endpoints rely on rate limiting, generic error responses, and Apple's App Attest as an optional Phase 3 hardening (`DCAppAttestService` assertion attached to auth requests; server verifies and can require it for the password endpoint once adoption is high).

### 6.5 Offline and sync

**Principle.** The app renders from a local store and treats the network as a way to refresh that store and drain a queue of pending changes. A user should never see a spinner for something they looked at an hour ago, and should never lose a session or a message because the rink has no signal.

**Local store.** SwiftData (iOS 18 baseline) behind a repository layer. Models mirror API DTOs, not database tables, so the schema follows the OpenAPI document. Each record carries `serverUpdatedAt`, `fetchedAt`, and a `syncState` (`synced`, `pendingCreate`, `pendingUpdate`, `pendingDelete`, `failed`). A `PendingMutation` table holds the outbox: endpoint, method, body, idempotency key, attempt count, last error, created time. If SwiftData proves unsuitable for the outbox under real load, GRDB is the sanctioned fallback; the repository interface hides the choice.

**Refresh policy per entity.**

| Entity | Refresh | Staleness the UI tolerates |
|---|---|---|
| `/me`, flags, entitlement | On launch, on foreground, after sign-in | 24 h; entitlement changes also arrive by push |
| Roster, lesson slots, practice summaries | On tab open with `If-None-Match`; background refresh every 4 h | 7 days (schedule is stable) |
| Plans and plan moves | On tab open; per-plan on open; after any edit | 7 days |
| Move library | On plan editor open | 30 days |
| Rooms list + last message | On tab open + realtime | 1 h; badge from push |
| Room messages | Cursor page on open; realtime while open; newest 200 cached per room | Unlimited (history is append-only) |
| Plan sessions | On plan open; own sessions cached indefinitely | Unlimited |
| Athlete detail, AI summaries, briefings | On open; cached with the server's content hash | Show cached with "as of" label; refresh on demand |
| Resources list | On tab open | 7 days; PDFs cached on device after first open |
| Live Board | 30 s while visible; ETag; Live Activity via push | Shows "Updated Xs ago"; degrades visibly after 3 min |

**Mutation queue.** Every write goes through the repository: apply optimistically to the local store, enqueue the mutation, attempt immediately if online. The drainer runs on foreground, on connectivity change, and in a `BGAppRefreshTask`. Retries use exponential backoff with jitter; 4xx responses other than 429 stop retrying and mark the record `failed` with the server's error code. Idempotency keys make retries safe.

**Conflict policy.** Append-only entities (messages, sessions, reports, feedback) cannot conflict. Scalar edits (plan title, notes, move fields, lesson slot times) are last-writer-wins by server time; the server returns the winning record and the client replaces its copy. Structural edits (reordering plan moves, activating a plan when the max-active rule would be violated) can be rejected with 409/422; the app surfaces these in a **Sync Center** (Settings → "Pending changes") where the user can retry or discard. The Sync Center badge appears on the Settings tab whenever anything is `failed`.

**What works offline.**

| Works fully | Works with queueing | Needs a connection |
|---|---|---|
| Browse roster, week schedule, athlete details (cached) | Create/edit lesson slots, cancel or reschedule an occurrence | Schedule import (camera → AI) |
| Browse plans, moves, templates; read plan detail | Edit plan fields, add/reorder/remove moves, activate/bench | Voice transcription and AI plan build (audio is saved locally and sent when online) |
| Run the session timer end to end; rate flow state | Submit the session | AI session summary, AI athlete summary, pre-lesson briefing refresh |
| Read cached conversations | Send text messages and voice notes (queued, shown as "Sending…") | Live Board, Ask Gradus, new conversation with someone not cached |
| Read cached resources and downloaded PDFs | Save an Ask Gradus answer for later | Sign in, sign up, invites, billing, account deletion |

**Session timer specifics.** The timer stores a start timestamp and accumulated pause intervals, never a running counter, so it is correct after the app is killed. A Live Activity shows elapsed time on the Lock Screen and Dynamic Island; local notifications remind at configurable durations. The web's `gradus.activeSession.v1` semantics (one active session per user, resumable) are preserved; the server remains the source of truth once submitted.

### 6.6 Realtime and push notifications

**Realtime.** Room views subscribe to `postgres_changes` on `messages` for the open room; the rooms list subscribes to inserts across the user's rooms to update previews and badges, replacing the web's polling where it exists. Realtime is a refinement over push and polling, not a dependency: if the channel drops, the room refetches on foreground.

**APNs sender (new server component; not built as of 2026-09-19, milestone P3 in §10.6).** Lives in the Worker (`src/lib/push.server.ts`), uses token-based APNs auth (`.p8` key, key ID, team ID stored as secrets), signs the JWT with WebCrypto, and POSTs to `api.push.apple.com` over HTTP/2. Handles `410 Unregistered` by deleting the token from `device_tokens`. Sends are fire-and-forget from the calling code path (guarantee §4.1.7) with structured logging.

**Triggers (native 2.0).** Because web and iOS share the same server functions after §6.2, every trigger fires regardless of which client performed the action.

| Event | Recipients | Payload route |
|---|---|---|
| New message in a room | Other participants (respecting blocks and the athlete persona rules) | `rooms/{roomId}` |
| Plan activated or assigned | The athlete and their guardians | `plans/{planId}` |
| Lesson wrap-up prompt (after a slot ends) | Coach | `coach/wrap-ups` |
| Guardian or coach connection accepted | The inviting side | `settings/connections` |
| Competition recap prompt (day after a followed competition) | Coach, parent | `recaps/{competitionId}` |
| Entitlement changed (Stripe webhook) | Coach or parent | `settings/plan` (silent push, refresh `/me`) |

Lesson reminders ("lesson in 1 hour") are a P1 addition driven by pg_cron calling a Worker hook, matching the existing hooks pattern.

**Payload shape.** `{"aps": {"alert": {...}, "badge": n, "sound": "default", "thread-id": "room:<id>"}, "gradus": {"type": "message", "route": "rooms/<id>", "v": 1}}`. Badge equals the unread total the server already computes. The app routes on `gradus.route` from a tap, and refreshes the relevant store on a silent push.

**Token lifecycle.** Ask for permission in context (first message thread opened, or from Settings), not at first launch. Register via `POST /devices` after permission; re-register whenever APNs rotates the token; `DELETE` on sign-out. Table `device_tokens` already exists with the right shape.

**Live Activities.** Push-to-start tokens (iOS 17.2+) are uploaded to `live_activity_tokens` so the server can start and update a Live Board activity for a followed skater without the app being open. Update frequency is bounded by the board refresh cadence (30 s). The session timer activity is local-only.

### 6.7 AI and voice

**Server-side AI is unchanged.** Ask Gradus, athlete summaries, pre-lesson briefings, session summaries, voice plan building, schedule-image parsing, and plan-from-results generation all run on the server through the Vercel AI SDK. iOS calls the corresponding endpoints and renders results. Long-running calls (briefing refresh, voice build) show progress and are cancellable client-side; the server keeps its current timeouts.

**Provider recommendation (Mariah's question: which route is more scalable?).** Today calls go through the Lovable AI Gateway (`ai.gateway.lovable.dev`) with `LOVABLE_API_KEY`, routed to Gemini. That is convenient but ties quota, billing, rate limits, and model availability to Lovable's plan. The scalable route is a **direct provider key** (Google AI for the same Gemini models) configured through the AI SDK's `@ai-sdk/google` provider. Because every call site already uses the AI SDK, the switch is one provider factory plus an environment variable; the model IDs stay the same so outputs do not change character. Recommended plan: add the direct provider behind an `AI_PROVIDER=lovable|google` switch in Phase 0, canary it on Ask Gradus, then flip the rest. This is invisible to users and reversible in one publish. It is not on the critical path for iOS and can slip without affecting the app.

**Audio capture on iOS.** Record with `AVAudioRecorder` as AAC in an `.m4a` container, mono, 24 kHz, ~32 kbps (voice-optimized; a 90-second note is under 400 KB). Show a live waveform from `averagePower`. Respect the existing limits: 90 s for the voice FAB, 180 s / 18 MB hard cap server-side.

**Transcription endpoint changes.** `voiceTranscribe` currently names the upload `voice.webm` when forwarding to ElevenLabs. The `/voice/transcribe` endpoint must accept `audio/mp4` and `audio/webm`, pass the correct filename and MIME type through, and keep the vocabulary hints (athlete names, move names) the web already sends.

**Voice notes in messages and cross-platform playback.** Web browsers record WebM/Opus; iOS records M4A/AAC. AVFoundation does not play WebM. Policy:

1. New notes from iOS are `.m4a`. New notes from the web should prefer `audio/mp4` where `MediaRecorder` supports it (Safari, current Chrome) and fall back to WebM only where it does not. This is a small web change and must be verified against the §4 rules (no behavior change for users; the message payload already carries the MIME type).
2. iOS plays `.m4a` with `AVPlayer` and plays legacy WebM notes through a hidden `WKWebView` audio element, which WebKit on iOS can decode. Verify on iOS 18 during Phase 1; if WebKit playback proves unreliable, bundle an Opus decoder as a fallback (P1). *As of 2026-09-19 the WebM fallback was never built: iOS shows "Can't play this note here yet" for a web-recorded note.*
3. *2026-09-19 (Mariah):* every voice note gets a **server-side transcript** at send time, stored on the message and returned to both clients, using the ElevenLabs path the guardian mirror already uses. iOS shows it under the bubble and reads it in the VoiceOver label. This is the WCAG 1.2.1 text alternative, and it also gives iOS users the content of legacy WebM notes. Milestone P4 in §10.6.

**On-device transcription.** Apple's `SpeechAnalyzer` (iOS 26+) is an attractive later option for offline dictation. Not in scope; the server pipeline is the source of truth so both platforms behave the same.

**Athlete learning loop (added 2026-09-20; decisions #14, #17, #18).** The claim on gradussports.com is that Gradus learns how long a given athlete takes to develop a new skill, where their ups and downs fall across a season, and folds competition results into the next plan. Today the backend holds one flow state per practice session at the plan level, a coach action (edited / redeployed / dismissed) per lesson wrap-up, a plan status of active or benched with no reason, a level on `athlete_goals` that is overwritten in place, and, for figure skating, the full judged protocol per competition. Nothing records when a skill was first attempted or first landed, so nothing can be learned about pace. The loop closes in two stages:

*Stage one, ships in 1.0 (§10.7 L1–L5): capture the signal and compute the trends deterministically.* There is no per-athlete machine learning in this stage, and none is needed to make the sentences on the website true.

1. **Skill events.** A new additive table `athlete_skill_events` (athlete, coach, move or plan-move, event kind, source, confidence, occurred-at, plan and competition references). Event kinds: `attempted`, `landed`, `consistent`, `parked`, `dropped`. Sources: `coach` (the "why" prompt), `protocol` (a competition element executed clean with non-negative GOE and no `<` or `*` mark), `inferred` (below). Athletes and parents record nothing new; their session log stays a mood and flow measure (§7.6) and is never turned into a per-move checklist.
2. **The coach "why" prompt.** When a coach benches a plan or removes a move from an athlete's plan, the client asks one question with three answers, *landed it / parking it / changed direction*, plus a one-tap skip (decision #17). The answer travels as an optional `reason` on the existing status and removal endpoints and becomes a `landed`, `parked`, or `dropped` event with `source = coach` and confidence 1.0. Skipping writes nothing. The prompt is a native alert on iOS, queued offline with the underlying edit.
3. **Level history.** Every write to `athlete_goals` also appends a row to `athlete_goals_history` (web PR #129: athlete, sport, who changed it by role and user, the new level, season goal and long-term goal, and the previous values of each, with a timestamp). It is written at the app layer by `goals-history.server.ts` from every goal write path, not by a trigger, because a trigger cannot see the author's role when the parent path writes through the admin client; any new goal write path must call the same helper. A level change is a row whose previous level is distinct from its new level. No UI change for this loop; this is the seasonal-pace signal.
4. **Protocol-derived events.** When a competition result is linked to an athlete (§7.10), each executed element becomes an `attempted` event and each clean element a `landed` event with `source = protocol`. Figure skating only until other sports have structured results.
5. **Inferred events.** A nightly pg_cron job (the existing cron pattern) looks for a move that left a plan without a coach answer, preceded by a sustained run of Locked-in or Flowing sessions on that plan, and writes a `landed` event with `source = inferred` and a confidence between 0 and 1. Inferred events are always shown to the coach as "likely" and are never promoted to certain without a coach or protocol event. The coach-labeled set is the check on the inference: the job's precision against coach labels is logged so the rule can be tuned or switched off.
6. **The athlete profile.** A server-side derived read (SQL over the tables above, computed on request and cached by input hash like the briefing) that yields, per athlete and sport: median days from first attempt to first landing by move category; the flow-state trend over the last 30, 90, and 365 days; competition scores over time; level changes with dates; and the calendar weeks where dips cluster. It is prompt-sized text, contains no free text the gateway has not already seen, and is injected into three existing prompts: plan drafting (`generatePlanFromResults`, which also starts reading the athlete's whole results history rather than one competition, and takes its persona from the athlete's sport rather than a hard-coded figure skating coach), the coach's athlete summary, and the pre-lesson briefing. Each prompt keeps its current instruction to report only what the data shows.
7. **Flow-state labels.** Every producer and consumer of `plan_sessions.state_index` uses the scale in `session-states.ts`: Frustrated / Pushing / Steady / Locked in / Flowing (decision #18). No module may carry its own scale for that column.

*Stage two, after launch (§10.7 L6): a learned model.* Once enough athletes have a season of skill events, a simple survival or regression model for time-to-land per move category, fit across athletes, conditioned on level and age, and personalized per athlete, runs as a scheduled server job and writes predictions to a table the prompts read. It lives where the data lives. **No on-device model** (no Core ML, no Create ML, no on-device training): the one-backend rule in §6.1 means iOS, web, and later Android must see the same athlete, and on-device training would silently diverge between clients. Whether to start L6 is a decision taken on evidence (§12 #17), not a launch commitment.

**Grounded Ask Gradus (added 2026-09-20; decisions #15, #16).** Ask Gradus today sends a persona system prompt and the question, nothing else, so it answers from general model knowledge. It becomes retrieval-augmented: the answer is written from passages retrieved out of a curated corpus, cites them, and says plainly when it had to fall back.

1. **Corpus v1.** (a) The six Athlete Survivors' Assist documents already in the library since 2026-09-20 (Abuse in Sports; Appropriate Athlete–Coach Relationships; Barriers to Reporting Abuse in Sports; Power and Control Wheel; Survivor Safety Plan; What to Do: Abuse & Neglect) and any further Assist material Mariah licenses; (b) the U.S. Center for SafeSport Code and the Minor Athlete Abuse Prevention Policies; (c) one rulebook set per supported sport, starting with figure skating (U.S. Figure Skating rulebook and the ISU technical rules), tennis (USTA *Friend at Court*), and golf (USGA/R&A *Rules of Golf*); (d) the coaching and athlete-development sources Mariah names (§12 #15); (e) each coach's own uploaded resource PDFs, indexed per coach and retrievable only for that coach's athletes and their guardians. Every source has a row in `knowledge_sources` recording title, publisher, version or edition, the rights basis for quoting it, and the date ingested; `docs/knowledge/SOURCES.md` is the human-readable ledger. **Nothing is ingested without a recorded rights basis** (§12 #16).
2. **Storage.** The `vector` extension; `knowledge_chunks` (source, sport or `all`, coach scope or null, chunk text, section heading, page, embedding, content hash). RLS: global chunks readable by the service role only (retrieval happens server-side); coach-scoped chunks carry the coach id and are filtered in the query. Chunking is per source type: rulebooks split on numbered clauses and keep tables whole; prose splits on headings with overlap. Chunk quality is verified against a fixed set of questions with known answer passages (`docs/api/vectors/knowledge/`), not by eyeballing.
3. **Ingestion runs in the Worker.** No session holds a service-role key (§4.1 rule 10), so ingestion is not a local script. A source is registered from the internal admin panel (web-only, §3), the PDF is read from the `resource-pdfs` bucket, chunked, embedded through the same Lovable AI Gateway the app already uses (Gemini Embedding 2; text-embedding-3 as the alternative), and written in batches through a `pgmq` queue drained by pg_cron, so a 300-page rulebook never runs inside one request. A coach upload enqueues its own ingestion on insert. Re-ingesting a changed source replaces its chunks by content hash.
4. **Retrieval and the prompt.** `askGradus` embeds the question, retrieves the top passages filtered by the asker's sport plus the sport-agnostic sources plus the asker's coach scope, and passes them to the model wrapped as untrusted content (the existing `ai-prompt-safety` helpers), with the instruction to answer only from the passages, to cite each one it uses, and to answer "not covered" when they do not cover the question. The audience personas and the minor-athlete safety rules stay exactly as they are.
5. **Fallback (decision #16).** On "not covered", a second call answers from general knowledge under the same persona, and the answer opens with one plain sentence that it is not drawn from Gradus sources. The response carries `grounded: false`. **Safety topics never fall back:** a question the classifier or the retrieved passages mark as abuse, grooming, self-harm, disordered eating, or injury concealment returns the Safe Sport panel content (hotlines and reporting links, §7.9) verbatim above whatever else is said, for every audience.
6. **Citations.** `POST /ask` returns `answer`, `grounded`, and `sources[]` (source title, section, page, and the resource id when the document is in the library so the client can open it). Saved answers keep their sources. The web server function keeps its current return shape; showing citations on the web is a later web change outside this PRD.
7. **Provider coupling.** Embeddings are tied to the embedding model: if §12 #4 ever flips the gateway to a direct provider key, the corpus is re-embedded in the same job, and a `knowledge_sources.embedding_model` column records which model produced each source's vectors so mixed states are detectable.

### 6.8 Payments and entitlements

**Decision.** No In-App Purchase, no StoreKit. Coach and Team subscriptions are purchased and managed on the web through Stripe. This is compliant provided the app follows the rules below, and it is the same posture the Capacitor submission plan already took.

**The rules the app follows.**

1. **Entitlement is displayed, never sold.** Settings → Plan shows the current tier, renewal or trial date, Founding Coach status, and roster capacity. There is no price list and no "Subscribe" button in the app outside the case in rule 3.
2. **Feature limits are stated without a purchase call-to-action.** For example the roster cap message becomes "Your roster is full on your current plan." (The web's "Upgrade to Coach Pro" wording is not used in the app.) Founding Coach and Club tiers are unaffected.
3. **Link-out only where permitted.** On the **United States storefront**, Apple's guidelines (updated May 2025 after Epic v. Apple) allow buttons and links to external purchase with no entitlement. The app checks `Storefront.current` and, for US users only, shows "Manage your plan at gradus.training" that opens Safari. For any other storefront the app shows plan status with no link and no instructions. Gradus is US-focused, so at launch the App Store availability can be US-only, which keeps this simple.
4. **Stripe never appears inside the app.** Checkout and the billing portal open in Safari via `UIApplication.open`, never in an in-app web view (both Stripe and Apple prohibit card entry in embedded web views). The web's `/coach/paywall` and parent Team pages already exist for this; after purchase the user returns to the app and the entitlement refreshes from `/me` (plus the silent push from the Stripe webhook).
5. **Coach invoicing is allowed in-app.** Coaches invoicing parents for lessons is a real-world service consumed outside the app (Guideline 3.1.3(e)); creating, sharing, and marking invoices paid is fine. Invoices are records; no money moves through the app.
6. **New coaches after the Founding window (2026-11-01).** With the paywall flag on, a brand-new coach who signs up in the app finishes onboarding and then sees the plan-status screen. In the US they get the link; elsewhere they get "Finish setting up your plan on the web" without a link. Sign-up itself is never blocked, which satisfies minimum-functionality expectations.

**App Review notes (prepared in Appendix D).** State plainly: subscriptions are multiplatform and purchased on the web; the app unlocks previously purchased access; US storefront linking follows 3.1.1(a); there is no purchase flow in the app; demo coach and parent accounts are provided.

### 6.9 Live Board

**What it is today.** A public web page per competition (`/board/<slug>`) built from a shared `competition_snapshots` row that the Worker refreshes from the USFS IJS results site at most every 30 seconds (one refresh serves every viewer; pg_cron keeps live boards warm). Three tabs: **Live** (each rink: just scored, on the ice, up next), **Schedule** (a departures board of the day's events), **Following** (skaters the viewer follows, matched by normalized name). Signed-in coaches and parents get their rostered skaters auto-suggested. Viewing a board records attendance, which later drives competition recap prompts.

**Product truth to preserve.** IJS never publishes who is currently skating. "On the ice" is inferred as the next start number after the last posted score, and scores post one to two minutes late. The three lanes exist so the inference sits next to the facts; the app must not present "on the ice" as authoritative, and must show the data age.

**Native requirements.**

| Area | Requirement |
|---|---|
| Entry | App tab "Live" visible to everyone, signed in or not. Board index lists live-window competitions and recently visited boards (local history, 20 items). Universal link `gradus.training/board/<slug>` and the rink QR codes open straight to the board. |
| Board screen | Same three tabs with a segmented control. Rink panel per sheet with the three lanes, protocol (score sheet) on tap, event results ranked by final placement, schedule grouped by day with status chips, follow search. Pull to refresh; automatic 30 s refresh while visible with `ETag`; "Updated 12s ago" indicator; visible stale state after 3 min. |
| Following | Follows stored locally and, for signed-in users, in `board_follows` (new, additive) so push and Live Activities can target them. Auto-follow suggestions from `getMySkaterNames` for coaches and parents. |
| Live Activity | When a followed skater's event is live: Lock Screen and Dynamic Island show the skater, start position, and lane state (up next → on ice → just scored with score). Started by push-to-start from the server when the event goes live; updated on each snapshot change that affects that skater; ended when the event is final. Compact island shows "#4 of 12". Frequent-updates entitlement requested. Falls back to app-driven activity updates while the app is foregrounded. |
| Widget | Small and medium Home Screen widgets: "Next up for my skaters" with time and rink, and the last posted score. Refreshed by timeline plus push when a Live Activity is active. |
| Attendance | Viewing a board while signed in calls `POST /competitions/{id}/attendance`, preserving the recap-prompt flow. |
| Accessibility | The skater wheel respects Reduce Motion (no spin), lanes have VoiceOver labels including data age, colors come from the accessibility-audited tokens. |
| Time | All times in the rink's timezone (`RINK_TZ` from the scraper), not the device's. |

The scraper, snapshot cache, and refresh lock stay server-side unchanged.

### 6.10 Deep links and universal links

The app claims `applinks:gradus.training`. The `apple-app-site-association` file is served from `public/.well-known/` (already verified to survive the production build) once the Team ID exists. Paths the app owns, and how it handles them:

| Path | Handling | Priority |
|---|---|---|
| `/board`, `/board/*` | Live Board index and board | P0 |
| `/i/:code` | Invite entry: resolves code kind (coach, parent, adult athlete) and routes into the matching sign-up or link flow | P0 |
| `/login`, `/signup/*` | Native auth screens | P0 |
| `/coach/*`, `/parent/*`, `/athlete/*` | Mapped to the equivalent native screen (Appendix C); unknown subpaths open the role home | P0 |
| `/g/:token` | Guardian claim flow | P1 |
| `/team/:token` | Guardian team invite | P1 |
| `/p/:token` | Shared plan preview and import | P1 |
| `/reset-password` | Native reset (requires the recovery token to reach the app; until then this path is excluded so Safari opens the web page) | P1 |
| `/privacy`, `/terms`, `/unsubscribe`, `/admin/*`, `/org-admin/*`, `/api/*`, `/email/*`, `/lovable/*` | **Excluded** from the app's paths; always open in Safari | — |

Custom scheme `gradus://` is registered as a fallback for QR codes and internal use only. Emails keep linking to `https://gradus.training/...` so that non-app users are unaffected.

### 6.11 Security and privacy

- **Transport.** ATS defaults (HTTPS, TLS 1.2+, forward secrecy). **No certificate pinning** (see §4.2). Add a CAA record for gradus.training at the DNS level as the actual mitigation.
- **Secrets.** The app ships only the Supabase publishable key and the Google iOS client ID. Everything else is server-side.
- **Storage at rest.** Keychain for tokens; the SwiftData store uses `NSFileProtectionCompleteUntilFirstUserAuthentication`. Cached PDFs and voice notes are in the app's Caches directory and purgeable. Sign-out wipes the store.
- **Minors.** Athlete accounts are created by parents and log in by username; the app never asks a minor for an email. Messaging keeps the athlete persona rules server-side. No third-party analytics or ads SDKs, so the App Privacy label lists only first-party collection (contact info, user content, identifiers for push, diagnostics) with the same answers already drafted for the Capacitor submission.
- **User-generated content (Guideline 1.2).** Report and block are one tap away in every room and on every profile the user can see, using the existing `submitReport` / `blockUser` logic. Blocked users' messages are hidden client-side immediately and server-side thereafter.
- **Account deletion (5.1.1(v)).** In-app, two taps from Settings, with the existing impact preview and confirmation phrase for accounts with minor athletes. Includes Apple token revocation.
- **Error reporting.** `POST /errors` mirrors `reportClientError` so iOS errors land in the existing admin errors dashboard. MetricKit crash and hang diagnostics are uploaded on next launch through the same endpoint. No third-party crash SDK in v1.
- **Screenshots and logging.** No PII in logs. Debug logging is compiled out of release builds.
- **Impersonation.** Admin impersonation is web-only; the API rejects impersonation tokens on `/api/v1`.

---

## 7. Feature requirements

**Priority key.** **P0** is built first and gates the internal and external TestFlight builds. **P1** is built second. **Everything tagged P0 or P1 ships together in native 2.0**, which is a full-parity release by decision (§0, #3). **P2** is later or never.

Each table lists the web behavior being ported and what is specifically required on iOS. Anything not called out is a straight port.

### 7.1 Sign-in, sign-up, and onboarding

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Sign in | Email or username + password with Turnstile; Google via broker | Native form; Sign in with Apple; Google (button hidden until the iOS client ID exists, 2026-09-19); password broker (§6.4). Remember identifier. Face ID gate optional. | P0 |
| Coach sign-up | Email + password or Google; promo code field; optional `?invite=` parent code; terms checkbox | Native equivalents; promo code applied via `/me/promo-code`; invite carried from `/i/:code`. | P0 |
| Coach onboarding | Name → sports coached → levels and hours per week per sport → invite code share; sample athlete and starter plan for new figure skating coaches; join a club by search or code | Native multi-step with progress; sport multiselect with the primary-sport cap rule; club join can be skipped and finished in Settings. | P0 |
| Parent sign-up | Email + password, beta code check, athletes (name + birthdate) → goals per athlete → practice schedule per coach; mid-flow recovery; invite coach card | Native multi-step; birthdate picker; schedule editor; resume where left off from `getParentSignupStatus`. | P0 |
| Athlete (minor) sign-up | Enter parent's 8-char code → confirm prefilled identity → choose username (availability check) + password | Native; username availability debounced via `/auth/username/check`; guardian and coach shown for confirmation. | P0 |
| Adult athlete sign-up | Direct sign-up, then coach link by code, goals, schedule | Native; same server flow. | P0 |
| Athlete onboarding (post sign-up) | Profile → coach → goals | Native. | P0 |
| Invite entry `/i/:code` | Resolves code kind and routes | Universal link handler; manual code entry screen with the 8-char alphabet keyboard rules. | P0 |
| Forgot / reset password | Email link to web reset page | Request from app; complete on web in the P0 wave; in-app in P1. | P0 / P1 |
| Terms acceptance | Blocking when version changes | Blocking sheet; version from `/me`. | P0 |
| Connection celebration | Full-screen moment when a coach–athlete link completes | Native animation with haptic; respects Reduce Motion. | P1 |
| Guardian claim `/g/:token` and team invite `/team/:token` | Claim an athlete as guardian, merge options if a parent account exists | Native flows. | P1 |

### 7.2 Coach — roster and schedule

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Roster tabs | Schedule / Athletes / Billing segments; sport filter chips | Roster tab with a segmented control; sport chips; search on Athletes. | P0 |
| Week schedule | Navigable week, lesson occurrences per athlete per day, color from practice flow states, expand row for actions | Native week strip with horizontal paging; day agenda list; occurrence card actions in a context menu and swipe. Cached offline. | P0 |
| Lesson slots | Create, edit, cancel one occurrence, reschedule occurrence, delete recurring; frequencies weekly / biweekly / twice monthly / monthly | Native sheet with date and time pickers; recurrence expansion done client-side with the same rules as `lesson-recurrence.ts` (ported to Swift with shared test vectors). Queued offline. | P0 |
| Athlete detail sheet | Parent, goals, practice and lesson minutes, active plans, trends, AI summary with refresh, also-coached-by list, practice target, competition results section, billing section | Native detail screen; AI summary shows cached copy with "as of" and a refresh action. Competition results and billing sections follow their own priorities. | P0 |
| Add athlete with guardian | Coach adds an athlete and invites the guardian by email; name-conflict dialog | Native. | P0 |
| Remove athlete | With confirmation | Native confirmation dialog. | P0 |
| Invite code | Persistent 8-char coach code, copy and share, rotate | Share sheet with link and code; rotate with confirmation. | P0 |
| Roster settings | Roster limits, default practice expectations | Native. | P0 |
| Practice targets | Set or clear a per-athlete weekly practice target | Native. | P0 |
| Pre-lesson briefing | AI narrative per athlete per date, cached by content hash, refreshable | Shown from the occurrence card; cached offline; refresh needs network. | P0 |
| Lesson wrap-ups | After a slot ends: Edit plan / Redeploy / Dismiss, once per athlete per day | Triggered by push and on foreground; native prompt card at top of Roster. | P0 |
| Coach visibility | See other coaches' plans for a shared athlete; request, respond, disconnect | Native list and actions. | P1 |
| Schedule import | Photograph or upload a lesson schedule; AI parses; review and commit; roster cap handling | Camera and Photos capture; review screen; requires network. | P1 |
| Join a club | Organization search, popular clubs, org invite code, clear link | Native; skippable at onboarding. | P0 (basic) |
| Post-event prompt | After a competition: link athletes to results, draft plans | See §7.11. | P1 |

### 7.3 Coach — plans and move library

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plans list | Filters Active / Drafts / Benched / Templates × athlete × sport; plan cards with dismiss X; swipe to delete | Native list with filter bar; swipe actions; search. Cached offline. | P0 |
| Plan detail and editor | Title, athlete, coach notes, moves from library (search), reorder, inline edit of name / description / cue / why / target reps or minutes, save to library, remove; flow-state bars; practice log; AI session summary; share to socials | Native editor with drag-to-reorder, inline sheets for move fields, library picker with search. Edits queued offline. AI summary and share need network. | P0 |
| Status | Activate / Bench / Delete; max-active conflict detection | Native with the server's 422 mapped to the same friendly copy. | P0 |
| Bench or remove: "why?" *(added 2026-09-20)* | — (new; §6.7) | On Bench, and on removing a move from an athlete's plan: a native alert with *Landed it / Parking it / Changed direction / Skip*. The answer rides on the existing status or removal call as an optional `reason`; Skip sends none. Queued offline with the edit; VoiceOver reads the four options; meets the §8.5 AAA rules. Never shown for templates or for deleting a whole plan. | P1 (§10.7 L2) |
| Templates | Plans without an athlete; clone into real plans | Native. | P0 |
| Move library | Browse, search, edit personal moves; sport and category dropdowns; archive | Native. | P0 |
| Starter programs | Adopt the Gradus starter plan (new figure skating coaches) | Native. | P1 |
| Plan sharing | Share token → public `/p/:token` page; import a shared plan; share-to-socials button | Share sheet; import flow from universal link. | P1 |
| Draft from competition results | Generate a plan from linked results | See §7.11. | P1 |

### 7.4 Coach — voice

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Voice FAB | Hold to record up to 90 s with live waveform and timer; ElevenLabs transcription; AI parses into a full plan (create mode) or edits to the open plan (edit mode); AI-touched fields highlighted with diffs | Native press-and-hold button with haptics, `AVAudioRecorder`, live level meter, cancel by slide. Audio saved locally first; if offline, queued and the user is told the draft will appear when online. Diff highlighting preserved. | P0 |
| Voice notes in messages | Push-to-talk recording, playback with progress | See §7.6. | P0 |

### 7.5 Messaging and safety (all roles)

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Conversations list | Rooms with last message, unread badges; new conversation from targets list; recipient chips for coaches | Native list; unread counts from push and realtime; new-conversation picker. Cached offline. | P0 |
| Room view | Three-way rooms (coach ↔ parent ↔ athlete), direct coach–coach and coach–parent rooms; text, voice notes, plan-tagged messages, "message coach about this plan" pre-tag; read marks; realtime; 500-message cap today | Native thread with cursor pagination, realtime, optimistic send with "Sending…", retry and delete-draft on failure; voice note record and play (§6.7); plan tag chip opens the plan. Keyboard-safe composer. | P0 |
| Unread total | Badge on tab | Tab badge and app icon badge. | P0 |
| Report and block | Report a user or message with reason; block and unblock; blocked users list in Settings | One tap from the room header and the message context menu; blocked list in Settings. | P0 |
| Report a resource | Parents and athletes can report a resource | With Resources (§7.9). | P1 |
| Competition recaps in messages | Recaps appear in the room | Native rendering of the recap message type. | P1 |

### 7.6 Practice sessions (parent and athlete)

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plan detail for the runner | Moves with expandable How / What / Why; flow-state bars; practice log with attribution (who logged) | Native detail; large touch targets; readable at arm's length. | P0 |
| Session timer | Start / pause / resume / end with screen wake lock; one active session across the app (persistent bar) | Timestamp-based timer; Live Activity; local notifications; persistent bar; keep-awake while the timer screen is visible. | P0 |
| Flow-state feedback | 5-point (Frustrated / Pushing / Steady / Locked in / Flowing) + note on end | Native sheet; submission queued offline with idempotency. *2026-09-20:* these five words are canonical everywhere, including every server prompt that reads a session (decision #18). The log measures how practice felt; it is never extended into per-move mastery ratings (§6.7). | P0 |
| Message coach about this plan | Pre-tagged message | Deep link into the room composer with the tag. | P0 |

### 7.7 Parent — athletes, coaches, goals, schedules, team

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| My athletes | Edit name and birthdate; athlete invite code and claim link (minors only); account status; add and remove athletes | Native disclosure per athlete. | P0 |
| Coaches per athlete | Link by coach invite code with preview; unlink; update sports; primary coach per sport; coach visibility toggles | Native. | P0 (visibility toggles P1) |
| Goals editor | Per sport: current level, season goal, long-term goal | Native form. Current level and season goal are also self-editable by the athlete regardless of age — see §7.8. | P0 |
| Practice schedule | Per coach: days, times, frequency, start date | Native editor with the same rules as the coach side. | P0 |
| Reset athlete password | Parent-issued | Native with confirmation. | P0 |
| Goals dashboard | Plans / Goals tabs on the Plans screen | Native. | P0 |
| Team plan and guardians | Up to three guardians per athlete; invite, resend, revoke, remove; Team plan status; billing on web | Guardian management native; plan status display; billing link per §6.8. | P1 |
| Guardian activity mirroring | Guardians see the same rooms, plans, and sessions | Comes for free from the server; verify in QA. | P0 |

### 7.8 Athlete — goals and motivation

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plans / Goals tabs | Same as parent minus management | Native. | P0 |
| Motivation card | Editable "What motivates you?" up to 500 chars; editable long-term goal | Native. | P0 |
| Goal editor (self) | Current level and season goal were parent-only in the original scope | **Mariah's call, 2026-09-16: wrong — editable by the athlete too, minor or adult.** Native level/season-goal picker on the athlete's own goal card, same fields as the parent's editor (§7.7). Uses the existing `PUT /adult-athlete/goals`: despite the path name, its RLS check (`athlete_can_self_connect`) is ownership-only (`athletes.user_id = auth.uid()`), not gated on `self_managed` or age — so it already authorizes a minor's own session. No backend change needed, only the iOS client and this doc were behind. | P0 |
| Coaches | Add a coach by code (parent-managed and adult athletes) | Native. | P0 |
| Parent or guardian | Guardian email on file, invite a guardian (adult athletes) | Native. | P1 |

### 7.9 Resources and Ask Gradus

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Library | Curated PDFs by sport, searchable, signed-URL viewer (iframe) | `PDFKit` viewer; downloads cached; share sheet. | P1 |
| Coach uploads | Upload a resource PDF for their athletes; delete | Files picker upload via signed upload URL. | P1 |
| Ask Gradus | Sport-scoped Q&A; parent persona and youth-athlete persona with safety guardrails; markdown answers | Native chat-style screen; render markdown with `AttributedString`; network required. | P1 |
| Grounded answers and sources *(added 2026-09-20)* | — (new; §6.7) | Each answer shows its sources as tappable rows under the text (title, section, page); a library source opens in the PDF viewer at that page. An answer with `grounded: false` shows the "not from Gradus sources" line the server already put first, styled as a note, not hidden. A safety-routed answer shows the Safe Sport panel inline above the text. Saved answers keep their sources. | P1 (§10.7 L5) |
| Saved answers | Save, view, delete | Native; cached offline. | P1 |
| Safe Sport panel | Hotlines and external reporting links for athletes | Static native panel; links open in Safari; **P0** because it is a safety feature, even though the rest of Resources is P1. | P0 |

### 7.10 Live Board, competition results, and recaps

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Live Board | See §6.9 | Native tab with Live Activity and widget. | P0 (widget P1) |
| Attendance and recap prompt | Viewing records attendance; next day a recap prompt appears for coaches and parents; recap sheet posts into messages | Attendance P0; recap prompt and sheet P1. | P0 / P1 |
| Competition results linking | Coach links a rostered athlete to a skater in a finished competition; results shown in athlete detail as stacked folders | Native. | P1 |
| Post-event prompt | Coach sees "link your athletes" after a competition; dismiss | Native card. | P1 |
| Generate plan from results | Draft a plan from an athlete's protocol | Native; network required. | P1 |

### 7.11 Billing and invoicing

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plan status | Tier, trial, Founding Coach, card-needed nudge, past-due banner | Display only per §6.8; banners preserved with neutral copy. | P0 |
| Choose / change plan, add card, billing portal | Embedded Stripe checkout and portal | **Web only.** US storefront gets a link; others get status only. | P0 (link) |
| Claim / restore Founding Coach tier | Free action | Native. | P1 |
| Athlete rates and invoices | Per-athlete rate (per session or hourly), draft lines from lessons, preview, create, mark paid, delete, share invoice via share sheet | Native invoicing screens; share via native sheet. | P1 |

### 7.12 Settings and account

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Profile | Name, email (coach: also coaching sports and levels) | Native. | P0 |
| Appearance | Light / Dark / System | Native; respects system by default. | P0 |
| Account & security | Change password, change email, delete account with impact preview | Native; password change through the SDK; delete per §6.4. | P0 |
| Device | Push toggle with permission state; Face ID / Touch ID lock | Native. | P0 |
| Legal | Privacy, terms, licenses | Opens web pages; adds open-source licenses screen. | P0 |
| Support / feedback | Feedback FAB on most screens; feedback list | Feedback from Settings and a shake gesture (optional); no floating button. | P0 |
| Sign out | | Native. | P0 |
| Connections hub (coach) | Enter a code, join a club, coach visibility | Native. | P1 |
| Pending changes (Sync Center) | Not on web | *Removed 2026-09-12 at Mariah's request* (gradus-ios PR #28): no screen and no Settings badge; the outbox engine still runs silently. | — |

### 7.13 Cross-cutting behaviors

- **Presence.** `POST /me/presence` on foreground, at most every 5 minutes (mirrors `useTouchLastSeen`).
- **Feature flags.** From `/meta/config`: paywall enabled, Coach Pro available, Founding cutoff date, minimum client version. Never compiled in.
- **Promo codes.** Pending code captured at sign-up and applied after the profile exists, with the same 5-attempt cap as the web.
- **Error boundaries.** Every tab has a recoverable error state with "Try again"; module-load recovery logic from the PWA is not applicable.
- **Haptics.** Light impact on primary actions, success/warning/error notifications on outcomes, matching the web's `haptic()` call sites.
- **Localization.** English only; strings in a catalog from day one so Kotlin and future locales can reuse them.

### 7.14 Explicitly web-only or dropped

Admin panel, org admin, email admin and previews, dev tools and paywall preview, impersonation, PWA install banner and update prompt, service worker chunk recovery, hydration diagnostics, Turnstile widget, embedded Stripe checkout, the `board` demo mode, and the Capacitor plugins (`@capacitor/*`, `@capgo/capacitor-native-biometric`). *2026-09-19:* the Capacitor iOS project can be removed from the web repo at any time, since the shell will not ship; the Android shell's fate is open (§12 #14), so `android/`, `capacitor.config.ts` and the web's `isNativeApp()` branches stay until that is decided.

---

## 8. Design system on iOS

**Intent.** The coach's-notebook, editorial-print feel carries over: paper backgrounds, translucent cards, serif display type, hyperlegible body text, "pen" accent colors used like highlighters. Navigation, gestures, controls, and motion are native iOS. A coach should recognize Gradus instantly and never feel they are using a web page.

### 8.1 Typography

| Role | Web token | iOS |
|---|---|---|
| Display / headings | `--font-display: EB Garamond` | Bundle **EB Garamond** (OFL). `Font.custom("EBGaramond-Regular", size:, relativeTo:)` mapped to `.largeTitle`, `.title`, `.title2`, `.title3`. Fraunces stays bundled for the Gradus wordmark only. |
| Body / UI | `--font-sans: Atkinson Hyperlegible` | Bundle **Atkinson Hyperlegible** (regular, bold, italics). Mapped to `.body`, `.callout`, `.subheadline`, `.footnote`, `.caption`. |
| Numbers / labels | `--font-mono: JetBrains Mono` | Bundle **JetBrains Mono** for scores, timers, invite codes, start positions. Tabular figures for the timer. |
| Hand accent | `--font-hand` (currently aliased to Atkinson in the app) | Not bundled. If the hand style returns, add Caveat later. |

All text uses Dynamic Type through `relativeTo:` so accessibility sizes work. Minimum body size is 17 pt at the default setting. Line lengths are capped at ~70 characters on iPad.

### 8.2 Color tokens

Tokens are exported from `src/styles.css` by a script in the web repo (`scripts/export-design-tokens.ts`) that converts the OKLCH values to sRGB for light and dark and writes a platform-neutral `docs/api/design-tokens.json`; CI checks it is current. The `gradus-ios` repo vendors that file with the API contract and generates `Colors.xcassets` from it, so web, iOS, and later Android never disagree on a color.

| Token | Light (web) | Dark (web) | iOS usage |
|---|---|---|---|
| `background` | paper `#F5F6FA` (oklch 0.972 0.005 250) | oklch 0.175 0.028 226 | Window and scroll backgrounds |
| `card` | white at 55% | oklch 0.255 0.012 245 at 62% | Cards over paper with `.ultraThinMaterial` beneath |
| `elevated` | oklch 0.982 0.004 250 at 62% | oklch 0.285 0.012 245 | Sheets, popovers |
| `divider` | `#E6E7EB` | oklch 0.36 0.012 245 | Separators |
| `text-primary / secondary / tertiary / disabled` | navy ink scale | warm cream scale | Text hierarchy; secondary is AAA on background |
| `accent` | pen-tennis (chartreuse) | pen-pool (cyan) | Primary actions, active tab; note the accent **changes hue** between modes exactly as on the web |
| `accent-ink` | tennis ink | pool | Text on accent surfaces |
| pen set `tennis / pool / orange / iris / pink`, each with `-wash` and `-ink` | as in styles.css | as in styles.css | Sport and flow-state coding, chips, Live Board lanes |
| `destructive`, `destructive-ink` | oklch 0.58 0.22 25 | oklch 0.7 0.17 25 | Delete, block, errors |
| Radii | 8 / 14 / 20 / 28 / 36 / 44 / pill | | Cards 20, sheets 28, chips pill, buttons 14 |
| Shadow | `shadow-card` | | One soft card shadow; none in dark mode beyond the inset highlight |

Theme follows the user's Appearance setting (Light / Dark / System), persisted locally and mirrored to the profile so web and app agree.

### 8.3 Component mapping

| Web component | iOS equivalent |
|---|---|
| Bottom nav (Roster · Plans · Resources · Messages · Settings; parent and athlete: Plans · Messages · Resources · Settings; Live added for all) | `TabView` with SF Symbols; Live Board tab present signed out |
| Sheet (vaul drawer) | `.sheet` with `.presentationDetents([.medium, .large])` and drag indicator; full-screen cover for editors |
| AlertDialog | `.alert` / `.confirmationDialog` |
| Popover / Dropdown / Context menu | `Menu`, `.contextMenu`, `.popover` on iPad |
| Card, Chip, Tag, Eyebrow | `GradusCard`, `GradusChip`, `GradusTag`, `Eyebrow` views in `GradusDesign` |
| SegmentedToggle | `Picker(.segmented)` restyled, or a custom segmented control where the web's look matters (Live Board) |
| `press` / `press-soft` button utilities | `PressButtonStyle` (scale 0.97, opacity, light haptic) |
| Sonner toasts | `ToastHost` overlay, bottom-anchored, swipe to dismiss |
| Skeleton | `.redacted(reason: .placeholder)` with shimmer |
| Voice FAB, Feedback FAB | Voice: floating record button on the plan editor only. Feedback: Settings row (no floating button) |
| Swipe to delete on plan cards | `.swipeActions` |
| Lucide icons | SF Symbols, with a small custom symbol set for sports and flow states |
| Logo | Vector asset (navy on cream mark already redrawn for the icon) |

### 8.4 Navigation and gestures

- One `NavigationStack` per tab with type-safe routes; deep links push onto the matching stack.
- Back is the system back gesture. No custom back buttons.
- Long lists support pull to refresh, swipe actions, and context menus.
- The composer, timer, and voice recorder respect the keyboard and safe areas; no content hides behind the tab bar.
- iPad: two-column layout for Roster (list → detail) and Messages (rooms → room); everything else is a centered readable column.

### 8.5 Motion, haptics, accessibility

- Motion is short (≤ 250 ms) and purposeful; the connection celebration and skater wheel honor Reduce Motion.
- Haptics as in §7.13. Never haptic on scroll or passive updates.
- VoiceOver labels on every control; the five icon-only buttons the web labeled get the same labels. Live Board lanes announce data age.
- Contrast stays at the web's AAA targets; Increase Contrast switches to opaque cards.
- Minimum hit target 44 × 44 pt. Dynamic Type through accessibility sizes without truncating scores or timers.
- *2026-09-19 (Mariah):* the app passes **WCAG 2.2 Level AAA** before QA starts. The 2026-09-17 audit is the checklist and the order of work is in §10.6. iPhone supports **landscape** (1.3.4). Score-sheet abbreviations (GOE, deductions, factor, IJS) are expanded on first use (3.1.4). Contextual help (3.3.5) is deferred and stays partial by design.

---

## 9. Engineering standards

### 9.1 Repositories and layout

Two repositories, one contract.

| Repo | Holds | Deployed by |
|---|---|---|
| `gradus-coach-start` (existing) | Web app, server logic, `/api/v1`, migrations, the Capacitor shells (`ios/`, later `android/`), and the contract files: `docs/api/openapi.json`, `docs/api/vectors/`, `docs/api/design-tokens.json`; this PRD | Lovable publish |
| `gradus-ios` (new) | The native Swift app, its generated client, and a pinned copy of the contract files | Xcode Cloud → TestFlight → App Store |
| `gradus-android` (later) | The Kotlin app, same pattern | Play Console |

**Why the split.** The web repo is production and Lovable syncs every commit on its `main`. Keeping the Swift codebase out of it means no iOS churn flows through the repo that serves current users, and the iOS repo gets its own macOS CI and release cadence. The backend API cannot move: it runs inside the Worker that Lovable deploys.

**How the contract flows.** `gradus-ios/Contract/` holds `openapi.json`, `vectors/`, and `design-tokens.json` plus a `SOURCE_COMMIT` file. `scripts/sync-contract.sh` fetches those files from `gradus-coach-start` at a given commit (via the GitHub API or a shallow clone), records the commit, and regenerates the Swift client and the color catalog. Updating the contract is a deliberate PR in the iOS repo, reviewed like any other. The iOS CI fails if generated code is stale relative to the vendored contract.

```
gradus-ios/
  Gradus.xcodeproj
  Gradus/                     app target (composition root, AppDelegate for push, scenes)
  GradusWidgets/              WidgetKit extension: Live Board Live Activity + widgets, session-timer activity
  Packages/
    GradusAPI/                generated OpenAPI client + auth broker + interceptors + DTOs
    GradusCore/               models, repositories, sync engine, outbox, feature flags
    GradusDesign/             tokens (generated from design-tokens.json), fonts, components, haptics
    FeatureAuth/  FeatureOnboarding/  FeatureRoster/  FeaturePlans/  FeatureVoice/
    FeatureMessages/  FeatureSessions/  FeatureBoard/  FeatureResources/  FeatureSettings/
  Contract/                   vendored openapi.json, vectors/, design-tokens.json, SOURCE_COMMIT
  scripts/sync-contract.sh
  Tests/                      unit (Swift Testing), UI smoke (XCUITest), snapshot (optional)
  docs/README.md              points at docs/ios/PRD.md in the web repo; iOS-only notes live here
```

*Amended 2026-09-19:* the native app is versioned `1.0.x`; there are no shell releases. The Capacitor `ios/` project can be deleted from the web repo at any time; `android/`, `capacitor.config.ts`, `native/`, and the `@capacitor/*` dependencies stay until the Android decision (§12 #14) is made. All of it is inert for the web.

### 9.2 Language, frameworks, dependencies

- **Swift 6** language mode with strict concurrency; SwiftUI throughout; `@Observable` view models; async/await; no Combine except where a framework demands it.
- **Deployment target iOS 18.0**, built with the current Xcode. iPhone and iPad device families.
- **Dependencies (kept minimal, all SPM):** `supabase-swift` (Auth, Realtime, Storage), `swift-openapi-generator` + `swift-openapi-urlsession`, `GoogleSignIn-iOS` (only if the native Google SDK path is chosen). No Firebase, no analytics SDK, no crash SDK, no UI kit. Markdown via `AttributedString`. PDFs via `PDFKit`. Audio via `AVFoundation`.
- **UIKit** only where SwiftUI lacks coverage (camera capture, share activity items, WKWebView audio fallback).

### 9.3 Architecture inside the app

- **Unidirectional data flow.** Views read from repositories through observable stores; writes go through repository methods that update the local store and enqueue mutations.
- **Repositories** are protocols with live and preview/mock implementations so every screen has SwiftUI previews and tests without a network.
- **Routing** is a single `AppRoute` enum decoded from universal links, push payloads, and in-app navigation.
- **Errors** are typed (`APIError` with the server's code) and mapped to user copy in one place.
- **Feature flags and client policy** are read from `/meta/config` and cached; a force-update screen appears when the client is below `minSupportedVersion`.

### 9.4 Backend engineering rules (in addition to §4)

- API routes contain no business logic; they validate, call the shared function, and serialize.
- Every endpoint has an OpenAPI entry with request and response schemas and at least one example; `bun run openapi` regenerates `docs/api/openapi.json` and CI diff-checks it.
- Every new table: migration with GRANTs and RLS; no service-role-only tables without a written reason in the migration header. Every service-role-only function: explicit `REVOKE … FROM PUBLIC, anon, authenticated` (§4.1 rule 12). After merge: ask Lovable to apply pending migrations, then run the precheck (§4.1 rule 11).
- Secrets (`APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `GOOGLE_IOS_CLIENT_ID`, `AI_PROVIDER`, `GOOGLE_AI_API_KEY`, `API_V1_ENABLED`) are set in Lovable Cloud secrets and read with `process.env`, like the existing ones.
- Idempotency keys expire after 24 h via pg_cron, matching the existing cron pattern.
- *Added 2026-09-20:* knowledge ingestion and skill-event inference run inside the Worker or as pg_cron jobs, never as local scripts (no session holds a service-role key). Every prompt that reads `plan_sessions.state_index` imports `stateLabel` from `session-states.ts`. Every `knowledge_sources` row has a rights basis before its chunks are written.

### 9.5 Testing

| Layer | What | Tool |
|---|---|---|
| Shared server functions | Unit tests on extracted functions with a fake Supabase client; contract tests that the API response matches the OpenAPI schema | `bun test`, zod schema validation |
| Recurrence and formatting parity | Shared JSON test vectors (`docs/api/vectors/*.json` in the web repo, vendored into `gradus-ios/Contract/`) run by both the TypeScript and Swift implementations of lesson recurrence, name normalization, session labels | `bun test`, Swift Testing |
| Sync engine | Outbox ordering, retry, idempotency replay, conflict handling, sign-out wipe | Swift Testing with an in-memory store and a scripted fake API |
| View models | State transitions per screen | Swift Testing |
| Critical flows | Sign in, open roster, open plan, send message, start and end a session, open a board | XCUITest on simulator against a mock API server |
| Manual | Real device, real accounts (the seeded demo coach and parent), the debug-only simulate-offline switch, background and kill scenarios; run by Claude Code, spot-checked by Mariah | Checklist in `docs/ios/QA.md` (created in Phase 4) |

Production is the only Supabase environment (Lovable preview shares it), so automated tests never hit it. Manual testing uses the existing demo accounts and clearly named test rooms.

### 9.6 CI, builds, releases

- **GitHub Actions, web repo.** Existing `Bun CI` (lint, typecheck, build) plus OpenAPI and design-token freshness checks. No macOS jobs here.
- **GitHub Actions, iOS repo.** A macOS job running `xcodebuild test` on every PR, plus a check that the generated client and color catalog match the vendored contract.
- **Builds and TestFlight.** Xcode Cloud (included with the developer program) connects to `gradus-ios`, archives `main` on tag, and uploads to TestFlight; internal testers get every build, external beta gets tagged releases. Fastlane is not required.
- **Versioning.** Marketing version `MAJOR.MINOR.PATCH`; build number auto-incremented by Xcode Cloud. `X-Gradus-Client` carries both.
- **Branching, web repo.** Backend work in short-lived branches merged to `main` by PR. Because Lovable also commits to `main`, PRs are rebased before merge and never left open across a day Mariah is editing in Lovable. Publishing to production remains a deliberate action in Lovable after CI is green.
- **Branching, iOS repo.** Short-lived branches merged by PR; no Lovable involvement. Cloud Claude Code sessions run on Linux and cannot build a SwiftUI app, so iOS work runs in local sessions on the Mac; backend work can run in the cloud.
- **Crash and error visibility.** MetricKit diagnostics and caught errors go to `/errors` and appear in the admin errors dashboard, tagged `platform=ios` with app version and build.

---

## 10. Milestones and delivery

### 10.1 How we work

Milestone-driven, no calendar. Milestones are taken one at a time in the order below; when one meets its definition of done, the next starts. Claude Code builds and verifies its own work (simulator, screenshots, tests, the simulate-offline switch). Mariah gets one short update a day with what changed, screenshots or a recording, and any decision that needs her; she taps through on her phone when she wants to. No time estimates are kept in this document. If a forecast is ever wanted, it is computed from the measured pace of completed milestones, not from benchmarks.

Two external dependencies gate specific milestones and can arrive at any moment: **Apple Developer enrollment** (TestFlight, push, Sign in with Apple, universal links) and **Google Play console setup**. When enrollment lands, the enrollment-gated milestones are taken next, whatever else is in progress.

**Definition of done, for every milestone:** merged to `main` of the right repo; CI green; verified on the simulator and, where behavior depends on it, a device; shown working in the daily update; nothing in §4 violated; judgment calls listed in the PR description.

### 10.2 Milestone sequence

Backend milestones live in the web repo and can run overnight in cloud sessions. iOS milestones live in `gradus-ios` and run on the Mac. Package numbers refer to the scope breakdown in Appendix F; endpoints are in Appendix A and screen requirements in §7.

**Backend**

| # | Milestone | Scope | Done when |
|---|---|---|---|
| B1 | API foundation | Package 0.1: plumbing, kill switch, meta, presence, terms, OpenAPI, tests | Merged and published; `/api/v1/meta/config` answers in production with the flag on; web guardrails (§2) unchanged |
| B2 | Auth broker | 0.2: Apple, Google, password and username, coach sign-up, recover, `auth_identities`, Apple revoke on delete | Each endpoint returns a working Supabase session for a real test account (Apple end to end once the key exists) |
| B3 | Domain endpoints, wave 1 | 0.3: messages, plans and moves, roster and schedule, sessions, settings for three roles, invites and sign-up flows | Every Appendix A endpoint for those domains live; server-function behavior unchanged; OpenAPI committed |
| B4 | Domain endpoints, wave 2, and push | 0.4, 0.5: board, competitions, resources, invoicing, guardians, visibility, org, voice accepting `audio/mp4`; APNs sender, triggers, device and Live Activity tokens, `board_follows` | Remaining endpoints live; a test device receives a push for a new message |

**iOS**

| # | Milestone | Scope | Done when |
|---|---|---|---|
| I1 | Repo and foundation | 1.1–1.5: `gradus-ios`, project and packages, contract sync, tokens and fonts, generated client, auth screens, local store and outbox, tab shell, routing, push registration | Sign in with email or username on a device; role tabs render; sync-engine tests pass; a universal link opens the app |
| I2 | Live Board | 2.11, 2.12 | A real or demo competition renders all three tabs; following persists; a Live Activity appears for a followed skater |
| I3 | Messaging | 2.6 | Text and voice notes exchanged with the web in the other seat; realtime; report and block |
| I4 | Sign-up and onboarding | 2.1 | A new coach, parent, minor athlete, and adult athlete can each sign up and onboard from the app; invite links work |
| I5 | Roster and schedule | 2.2, 2.3 | Week schedule matches the web for the demo coach; slot create, edit, cancel, reschedule round-trip; athlete detail, briefing, wrap-ups |
| I6 | Plans, library, voice | 2.4, 2.5 | Plan editor round-trips every field with the web; templates clone; the voice FAB produces a plan |
| I7 | Sessions and timer | 2.7 | Timer survives lock and kill; Live Activity; feedback submits; the session shows on the web |
| I8 | Settings for all roles | 2.8, 2.9, 2.10 | Parent athlete, coach, goals, and schedule management; athlete goals; account and security including deletion; plan status; Sync Center |
| I9 | Offline and push, end to end | 2.13, 2.14 | Every write in I3–I8 queues offline and drains; push routes to the right screen; badges correct |
| **T1** | **Internal TestFlight** (needs App Store Connect set up; taken after the §10.6 gate) | Xcode Cloud, internal group | A build installs from TestFlight on Mariah's phone; QA begins |
| ~~C1~~ | ~~Capacitor iOS 1.0 to the App Store~~ **Dropped 2026-09-19** | — | — |
| T2 | External TestFlight | I1–I9 complete | Founding Coaches and a few parents are using it |
| I10 | Resources and Ask Gradus | 3.1, 3.2 | Library, PDF viewer, coach upload, Ask Gradus, saved answers |
| I11 | Invoicing | 3.3 | Rates, preview, create, detail, status, share |
| I12 | Competitions and recaps | 3.4 | Results linking, post-event prompt, plan from results, recap flow |
| I13 | Guardians, team, visibility, celebration | 3.5 | Guardian claims and team invites; coach visibility; connection celebration |
| I14 | Import, share, starters, connections hub, in-app reset | 3.6, 3.7 | Schedule import; plan share and import; starter programs; Founding claim; password reset in-app |
| I15 | Widget, lesson reminders, App Attest | 3.8 | Widget shows next up; reminders arrive; App Attest on auth |
| C2 | Capacitor Android 1.0 to Google Play, **reopened 2026-09-19** (§12 #14) | Phase D | Mariah decides whether it ships at all |
| L1–L5 | Athlete learning loop and grounded Ask Gradus *(added 2026-09-20)* | 3.10–3.12; the milestone table is §10.7 | Taken after the §10.6 gate, alongside T1/T2 QA, as TestFlight builds; all five merged before I16 |
| I16 | Hardening and submission of native 1.0 (was 2.0) | Phase 4, plus 3.9 preparation; the pre-QA gate in §10.6 and the §10.7 milestones L1–L5 come first | QA checklist passes; crash-free ≥ 99.5% on TestFlight; submitted |
| L | Native 1.0 live | | Approved; first store release, no shell migration |
| K | Kotlin rebuild starts | its own PRD | |
| L6 | Learned pace model *(added 2026-09-20; post-launch, not gating)* | 3.13 | Taken when §12 #17 says the data supports it |

### 10.3 Build order rationale


1. **API first** so no screen is ever blocked on the backend, and so the web-safety refactor happens while attention is highest.
2. **Foundation before features** so offline, auth, and routing are not retrofitted.
3. **Live Board and messaging first among features** because they are the most time-sensitive (competition season), the best demonstration of native value, and the least entangled with the rest of the app.
4. **Plans and roster next** because they are the coach's daily loop and the largest packages, so they need the longest bake in TestFlight.
5. **Settings and sign-up after the daily-loop features** because until external TestFlight, testers can be provisioned on the web.

### 10.4 Web sunset plan (for coaches, parents, athletes)


Sunset is a Mariah decision, made when all of the following hold (the week counts below are measurement windows, not forecasts):

1. Every P1 item is shipped and verified on device, and no P0/P1 bug has been open more than two weeks.
2. Crash-free sessions ≥ 99.5% for four consecutive weeks.
3. iOS accounts for ≥ 90% of weekly-active coaches, parents, and athletes **who use Apple devices** for four consecutive weeks, driven by a "Get the app" banner on the mobile web.
4. **The Android app is live.** The web is sunset for the three roles only once both native apps exist, so Android users are never stranded. Desktop users of those roles go **native only** (decided 2026-09-04): the iOS app runs on Apple-silicon Macs as-is, a Mac build is a modest later addition, and Windows users use their phone.
5. Communications are ready: 30-day notice email, in-web banners, a support article, and an App Store redirect for mobile Safari on the retired routes.

After sunset, the web app keeps: sign-in (for admin and org admin), `/admin/*`, `/org-admin/*`, public pages (`/board/*`, `/p/*`, `/privacy`, `/terms`), the auth email landing pages, and `/api/*`.

**Building in Claude Code instead of Lovable does not by itself require leaving Lovable Cloud.** Lovable Cloud keeps hosting the database and, through Publish, deploying the Worker that serves the admin panel and `/api/v1`. Commits arrive from GitHub whether or not anyone edits in Lovable, and Publish stays a deliberate click. Moving hosting to a Gradus-owned Cloudflare account, or owning the Supabase project outright, are separate later projects (§11, risk 15) with their own runbooks.

### 10.5 Interim store presence with the Capacitor shell

> **Superseded 2026-09-19.** Mariah decided to go straight to native: no Capacitor iOS shell ships, native is 1.0, and the Android shell question is reopened in §12 #14. The section is kept as the record of the earlier reasoning.


**The mechanics.** An App Store app is identified by its bundle ID under a team, and a Play Store app by its application ID and signing key. A new build with the same identifier and a higher version is an update, whatever technology is inside it. So the Capacitor shell (`training.gradus.app`) can go live first and be **replaced by the native app as an ordinary update** later; nothing has to be chosen now. Ratings, reviews, the listing, universal links, and APNs device tokens carry over. Two caveats:

- **Users sign in once more.** The shell keeps the Supabase session in WKWebView local storage, which the native app cannot read. The update should open on a short "Welcome to the new Gradus" screen that leads to sign-in. Nothing else needs migrating; everything lives on the server.
- **The iOS 18 floor leaves older devices behind.** The shell runs on older iOS versions than the native app does. Devices that cannot update keep the last shell version, which keeps working only as long as the web app for their role is live. The sunset plan must count those users (a small population: iOS 18 covers iPhone XS and later).

On Android the same holds for a Kotlin app replacing a Capacitor build, provided the Play upload key is kept (back it up; Play can reset it through support if lost).

**Whether to do it.** Shipping the iOS shell before the native app is possible but not free. The shell still needs Sign in with Apple for Guideline 4.8, a defensible answer to the minimum-functionality rule, and its own review cycle; that is work that does not advance the native app, and users would be asked to sign in again when 2.0 arrives. The App Store Connect record, App ID, keys, and association file are needed for the native app anyway and are set up at enrollment regardless.

Android is the more interesting case: Kotlin starts only after iOS 2.0 is complete, so Android users would otherwise have only the PWA (with no push) until then. Generating the Capacitor Android app is a bounded job (JDK 17, Android Studio, `cap add android`, an AAB, the Play Console listing, `assetlinks.json`) and is fully replaceable by Kotlin later under the same application ID.

**Decision (2026-09-04).** Ship the Capacitor iOS shell as **1.0** at enrollment, then the Capacitor Android shell as the interim Android app right after iOS 1.0 is live (so the Capacitor work happens once, while it is fresh), and ship the native app as **2.0** at full parity. Version numbers: shells are 1.x, native starts at 2.0 so App Store Connect always sees an increase. The 2.0 update opens on a welcome screen that explains the one-time sign-in. Store listings are refreshed with native screenshots at 2.0.

### 10.6 Pre-QA gate and the milestones that close it (2026-09-19)

Mariah's definition of "ready to move to QA," recorded 2026-09-19: **(1) every Apple-developer-gated element is integrated into the app, and (2) the app passes WCAG 2.2 Level AAA** per the 2026-09-17 audit. QA itself starts with T1, the first internal TestFlight install on her phone, and **runs against production with `API_V1_ENABLED` on** (her decision and her action in Lovable Cloud secrets; no Claude session flips that flag). The working plan, sequencing and current state live in `docs/ios/handoff-preQA.md`; this section is the durable summary.

**Account side (Mariah).** App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple and App Groups; the widget App ID `training.gradus.app.widgets`; the App Group `group.training.gradus.app`; an APNs key and a Sign in with Apple key; the Team ID; the five Lovable secrets in Appendix D; the App Store Connect record; Xcode Cloud connected to `gradus-ios` with an internal TestFlight group. Later, not blocking: a Google Cloud iOS OAuth client, and the `gradus://reset-password` entry in the Supabase redirect allow-list. After every migration PR merges: ask Lovable to apply pending migrations, then run the `docs/api/SMOKE.md` precheck (§4.1 rule 11).

**Build milestones, in order (no dates, per §10.1):**

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| P1 | Docs | web | This amendment; `docs/ios/handoff-preQA.md` | Merged |
| P2 | Apple wiring on iOS | iOS | Sign in with Apple entitlement; `DEVELOPMENT_TEAM` once the Team ID exists; marketing version 1.0.0; Google button hidden until configured; Xcode Cloud scripts; contract re-sync | CI green; archive-able once the Team ID is in |
| P3 | Push, web wave, then a small iOS wave | web, iOS | APNs sender in `src/lib/push.server.ts`, the §6.6 triggers, lesson-reminder delivery, `live_activity_tokens` with `POST /live-activities/tokens`, board push-to-start, update and end, the AASA file with the Team ID; iOS uploads push-to-start and update tokens | A test device receives a message push and a board Live Activity started by the server (verified at T1) |
| P4 | Voice-note transcripts | web, then iOS | Additive `messages.transcript`; transcribe every voice send (WebM and M4A) through the existing ElevenLabs path, plus a sweep for old notes; transcript in room payloads; iOS shows it under the bubble and in the VoiceOver label | A web-recorded note shows its transcript on iOS |
| P5 | Accessibility: reflow, landscape, targets | iOS | Audit items 5, 6, 8: scrolling Terms gate and celebration cover; no single-line truncation of user content; stacked layouts at accessibility sizes; text-style icon fonts; 44 pt targets; landscape enabled and every screen checked in it | The audit harness at AX5 and in landscape shows no truncation and no sub-24 pt targets |
| P6 | Accessibility: tokens, lock screen, hygiene | web token export, then iOS | Audit items 7, 9, 10: light `destructive-ink` ≥ 7:1 and a dark ink on the dark destructive fill (web token change, synced through the contract), an Increase Contrast variant via `colorSchemeContrast`, ink tokens in the widget and Live Activity, `accentInk` toggles and focus rings, dimmed-text fixes, page-title stripe; content hidden behind the biometric lock; celebration identifier moved off the root | The audit's contrast table passes AAA in both appearances |
| P7 | Accessibility: everything else in the audit | iOS | Semantics (picker names, spelled-out codes, `textCase`, expand/collapse values, headings), forms (confirmations, "Error:" prefixes, Report-sheet default, disabled-reason copy, failed-load states), navigation (Safari-bound link labels, sheet titles and close buttons), media (image labels, import-result announcement), readability (jargon expansions, spoken date); contextual help deferred | Audit §6 shows only 3.3.5 as partial |
| P8 | Device pass and re-audit | iOS | Live VoiceOver, Switch Control, Voice Control, Full Keyboard Access and iPad on a device; re-run the audit harness; fix findings | Findings closed; harness clean |
| P9 | QA prep | web, iOS | `docs/ios/QA.md`; `POST /errors` and the MetricKit upload; the real Google provider once the client ID exists; native reset on once the allow-list entry exists | T1 build installs; QA begins |

### 10.7 Athlete learning loop and grounded Ask Gradus (2026-09-20)

Mariah's decision, recorded 2026-09-20: the website's "How it works" promises (Gradus learns each athlete's pace and seasonal trends; competition results feed the next plan) and a source-grounded Ask Gradus are **part of native 1.0**, and a trained model is not. §6.7 has the design; this section is the delivery record. The milestones are taken after the §10.6 gate closes, in parallel with QA on TestFlight (T1, T2), and all of L1–L5 must be merged before I16 begins. Web PR #127 (the flow-state label fix, decision #18) is already open and is a prerequisite for L3.

**Build milestones, in order (no dates, per §10.1):**

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| L1 | Skill events and level history | web | Migration for `athlete_skill_events` with GRANTs and RLS; `athlete_goals_history` arrives with web PR #129 and only needs the profile read in L3 to consume it; optional `reason` on `POST /plans/{id}/status` and `DELETE /plans/{id}/moves/{moveId}` (and on the matching web server functions, additive, default absent); protocol-derived events on results linking; OpenAPI and vectors | In Lovable preview: a bench with a reason, a removal with a reason, a level change (via PR #129's helper), and a results link each produce the expected rows; a skipped prompt produces none |
| L2 | Coach "why" prompt | iOS | The alert on Bench and on move removal (§7.3); `reason` on the outbox entry; contract re-sync; VoiceOver and AAA checks in the audit harness | Simulator: each answer round-trips to the preview and appears as an event; Skip sends no reason; offline edits drain with their reason |
| L3 | Athlete profile in the prompts | web | The derived profile read with input-hash caching; the inference job and its precision log; profile injected into plan drafting, the athlete summary, and the briefing; `generatePlanFromResults` reads the full results history and is sport-aware; vectors for each prompt | Prompt snapshots in tests show the profile block; the inference job runs in preview and logs precision against coach labels; web answers unchanged in shape |
| L4 | Knowledge corpus | web | `vector` extension; `knowledge_sources` and `knowledge_chunks`; the pgmq/pg_cron ingestion path; admin-panel registration; per-coach ingestion on resource insert; chunkers per source type; `docs/knowledge/SOURCES.md`; corpus v1 ingested (§6.7) with a rights basis for every source | Every corpus v1 source has chunks in preview; the known-answer question set retrieves the expected passage at top-3 for ≥ 90% of questions |
| L5 | Grounded answers | web, then iOS | Retrieval in `askGradus`; citations, `grounded`, safety routing, fallback sentence; saved answers keep sources; OpenAPI; iOS sources rows, PDF deep-open, fallback note, inline Safe Sport panel | A parent question about a rule cites the rulebook; a minor's question about pain routes to the panel; an off-corpus question returns `grounded: false` with the sentence first; all three verified on iOS against preview |
| L6 | Learned pace model *(post-launch)* | web | Scheduled fit of time-to-land per move category; predictions table; the profile reads predictions when present | Taken only when §12 #17 is decided yes; not part of 1.0 |

**What the web gets for free.** Because the grounding and the profile live inside the shared server functions, web users receive the same grounded answers and sharper drafts the moment each milestone publishes. The web shows no citations until a separate web change; that is the only visible difference between the clients, and it is deliberate under §4.1.

---

## 11. Risks and dependencies

| # | Risk or dependency | Impact | Mitigation |
|---|---|---|---|
| 1 | ~~Apple Developer enrollment slips~~ **Closed 2026-09-19: enrollment approved.** Remaining dependency: App Store Connect setup (App ID, keys, Team ID, Xcode Cloud) | Delays TestFlight, push, Sign in with Apple, and universal-link testing | The §10.6 milestones that need the account are ordered so everything else proceeds meanwhile. |
| 2 | Sign in with Apple through our own broker rather than a Supabase provider | Reviewer questions; token revocation needs the Sign in with Apple key | Standard OIDC verification; generate the key the day enrollment completes; test revocation before submission. If Lovable Cloud later exposes an Apple provider, switch to `signInWithIdToken` with no client change. |
| 3 | Lovable Cloud limits without a Supabase dashboard (Google authorized client IDs, email-confirmation setting, pg_cron access) | Could force the broker path for Google and shape sign-up | Broker path is already the default design; verify settings in Phase 0 week one. |
| 4 | Lovable two-way GitHub sync colliding with Claude Code PRs (backend PRs only; the iOS repo is outside Lovable's sync) | Merge conflicts, accidental publishes | Short-lived branches, rebase before merge, publish deliberately after CI; avoid overlapping edits on the same day (§9.6). |
| 5 | Behavior-preserving refactor accidentally changes web behavior | Web regression | One domain per PR, typecheck and build gates, preview smoke, kill switch, revert-first policy (§4). |
| 6 | Cross-platform voice-note formats | iOS cannot play legacy WebM | WKWebView playback fallback verified in Phase 1; Opus decoder as P1 fallback; web prefers M4A going forward. |
| 7 | Offline conflicts confuse users | Lost or duplicated edits | Idempotency everywhere, append-only design for sessions and messages, last-writer-wins for scalars, visible Sync Center. |
| 8 | App Review pushes back on web-only subscriptions | Rejection or delay | US-only storefront at launch, no purchase CTAs, link-out only in the US, prepared review notes; fallback is removing the link. |
| 9 | Live Activities update budget and entitlement | Stale Dynamic Island | Request frequent-updates entitlement; degrade to foreground updates; 30 s cadence already bounded server-side. |
| 10 | Realtime fan-out on `messages` as the app grows | Supabase Realtime limits | Fine at current scale; move to per-room broadcast from a database trigger if connection counts climb (P2). |
| 11 | Decision latency | Work stalls when a product decision waits | One short review per day; Claude Code verifies on its own and batches decisions into that update. |
| 12 | IJS page structure changes | Board goes stale | Existing server-side risk, unchanged; the app shows data age and degrades visibly. |
| 13 | Founding Coach window closes 2026-11-01, likely before the native launch | New iOS coaches hit the paywall immediately | US link to the web paywall; consider extending the window through the native launch (business decision). |
| 14 | Kotlin rebuild later | Rework if the API is iOS-shaped | OpenAPI as the contract, shared test vectors, platform-neutral string catalog, no iOS-only endpoints. |
| 16 | ~~Capacitor 1.0 rejected under Guideline 4.2~~ **Moot 2026-09-19: the shell does not ship.** | — | — |
| 15 | Leaving Lovable Cloud someday | Auth, DB, storage migration | Out of scope. Lovable now documents an export path ("Export project data" then connect your own Supabase) and third-party migrators preserve auth passwords; the API is the only client that would need re-pointing. Write a runbook before attempting it. |
| 17 | *(2026-09-20)* Rights to quote corpus sources (USFS rulebook is member-gated; SafeSport Code and The Assist's materials carry no stated reuse license) | A source cannot be ingested, or must be linked rather than quoted | `knowledge_sources.rights_basis` is required; §12 #16 owns the confirmations; a source without a basis is listed in the library and cited by title only, never quoted. |
| 18 | *(2026-09-20)* Retrieval quality on rulebooks (tables, numbered clauses) | Confident answers from the wrong clause | Per-source chunkers; the known-answer question set gates L4; answers cite section and page so a coach can check. |
| 19 | *(2026-09-20)* Inferred skill events are wrong | A plan draft targets a skill the athlete has not landed | Inferred events are always "likely", never certain; drafts stay drafts the coach edits; the inference job's precision against coach labels is logged and the rule is switched off if it falls below the bar set in L3. |
| 20 | *(2026-09-20)* Embedding model coupling to the Lovable gateway | A provider switch (§12 #4) silently mixes vector spaces | `embedding_model` recorded per source; the switch re-embeds in the same job; mixed states fail the precheck in `docs/api/SMOKE.md`. |
| 21 | *(2026-09-20)* Minors' data in prompts | More athlete data reaches the model provider | The profile is derived aggregates plus fields the gateway already receives today; no new free text; no third party beyond the existing gateway; covered by the current privacy disclosure (§6.11). |

---

## 12. Open decisions

| # | Decision | Owner | Needed by | Default if undecided |
|---|---|---|---|---|
| 1 | Native release scope | Mariah | — | **Resolved 2026-09-04: full parity in native 2.0** |
| 2 | Pace and staffing | Mariah | — | **Resolved 2026-09-04: milestone-driven, no time estimates; one daytime stream plus overnight backend runs** |
| 3 | Google sign-in: broker in our API vs Lovable Cloud own-credentials with authorized iOS client ID | Claude Code, after checking Lovable Cloud auth settings | Before B2 | Broker |
| 4 | AI provider switch (Lovable gateway → direct Google key) timing | Mariah | Any time | Add behind a flag during B3, flip after the native launch |
| 5 | Coach sign-up email confirmation behavior in Lovable Cloud (on or off) | Verify in Lovable Cloud | Before B2 | Mirror whatever the web does today |
| 6 | Voice-note playback fallback: WKWebView vs bundled Opus decoder | Claude Code, after device verification | During I3 | WKWebView |
| 7 | App Store availability at launch: US only vs worldwide | Mariah | Before submission | US only |
| 8 | Extend the Founding Coach window through the native launch | Mariah | Before 2026-11-01 | No change |
| 9 | Desktop use by the three roles after sunset | Mariah | — | **Resolved 2026-09-04: native only** (iOS app on Apple-silicon Macs; Mac build later) |
| 10 | Live Activity for the session timer: local only vs also pushed to guardians' devices | Mariah | During I7 | Local only |
| 11 | Xcode Cloud vs GitHub Actions for TestFlight uploads | Claude Code | During I1 | Xcode Cloud |
| 12 | Whether iPad gets full attention in native 2.0 or "works, not optimized" | Mariah | During I5 | Works, not optimized |
| 13 | Capacitor iOS shell as interim 1.0 (§10.5) | Mariah | — | **Reversed 2026-09-19: no shell; native ships first as 1.0** |
| 14 | Capacitor Android shell as interim Android app (§10.5) | Mariah | Before the Kotlin decision | **Reopened 2026-09-19:** with no iOS shell there is no "after iOS 1.0 is live" trigger; Mariah decides whether the Android shell ships at all or Android waits for Kotlin |
| 15 | *(2026-09-20)* Which coaching and athlete-development sources join corpus v1 | Mariah | Before L4 | The USOPC American Development Model materials, plus The Assist's Compassionate Coach and Compassionate Parent course materials if licensed; nothing described only as "best practices" without a document behind it |
| 16 | *(2026-09-20)* Rights confirmations for quoting the USFS rulebook, the SafeSport Code and MAAPP, and The Assist's six documents | Mariah | Before L4 | Ingest only sources with written permission or a public license; the rest are cited by title and linked, not quoted |
| 17 | *(2026-09-20)* Whether and when to start L6, the learned pace model | Mariah, on Claude Code's evidence | After launch, when ≥ 30 athletes have a season of skill events | Not started; the deterministic profile stands in |
| 18 | *(2026-09-20)* Whether athletes or parents ever see their skill history directly | Mariah | Before L2 | Not in 1.0: the coach sees "likely landed" hints in the plan editor; athletes and parents see it only as sharper plans |

---

## Appendix A — Server function → API v1 endpoint map

Every user-facing `createServerFn` and its `/api/v1` counterpart. Admin, org-admin, email, impersonation, dev, and Turnstile functions are intentionally absent. "Pri" is the client priority from §7; the endpoint itself is built in Phase 0 regardless, since wrapping is cheap and Kotlin will need it. `[pub]` = no auth. `[idem]` = accepts `Idempotency-Key`. `[etag]` = supports `If-None-Match`. `[page]` = cursor pagination.

### Auth and session (new; no web equivalent)

| Endpoint | Source | Pri |
|---|---|---|
| `POST /auth/apple` `[pub]` | new (Apple JWKS verify → identity → session mint) | P0 |
| `POST /auth/google` `[pub]` | new | P0 |
| `POST /auth/password` `[pub]` | new; uses `resolveAthleteLogin` logic for usernames | P0 |
| `POST /auth/signup/coach` `[pub]` | new; mirrors web `supabase.auth.signUp` | P0 |
| `POST /auth/recover` `[pub]` | new; `resetPasswordForEmail` with admin credentials | P0 |
| `POST /auth/username/resolve` `[pub]` | `resolveAthleteLogin` | P0 |
| `POST /auth/username/check` `[pub]` | `checkAthleteUsername` | P0 |
| `GET /me` `[etag]` | composite: `getMyRole`, `getCoachProfile` / `getParentSettings` (summary) / `getAthleteSettings`, `getTermsStatus`, `getMyGuardianStatus`, `getUnreadTotal`, `getTeamPlanStatus`, flags | P0 |
| `GET /me/terms` · `POST /me/terms/accept` | `getTermsStatus`, `acceptTerms` | P0 |
| `POST /me/presence` | `touchLastSeen` | P0 |
| `GET /me/deletion-impact` · `DELETE /me` | `getDeletionImpact`, `deleteMyAccount` (+ Apple revoke) | P0 |
| `POST /me/promo-code` · `POST /promo-codes/validate` | `applyPromoCodeToMyProfile`, `validatePromoCode` | P0 |
| `GET /me/celebrations` · `POST /me/celebrations/{id}/ack` | `getPendingConnectionCelebrations`, `acknowledgeConnection` | P1 |
| `POST /devices` · `DELETE /devices/{token}` | `registerDeviceToken`, `unregisterDeviceToken` | P0 |
| `POST /live-activities/tokens` | new | P0 |
| `POST /errors` | `reportClientError` | P0 |
| `POST /feedback` | `submitFeedback` (`listFeedback`, `setFeedbackResolved` are admin) | P0 |
| `GET /meta/config` `[pub]` · `GET /meta/client-policy` `[pub]` | new (env flags: paywall, Coach Pro, Founding cutoff, min client version) | P0 |

### Invites and connections

| Endpoint | Source | Pri |
|---|---|---|
| `POST /invites/resolve` `[pub]` | `resolveInviteCode` | P0 |
| `GET /coach/invite-code` · `POST /coach/invite-code/rotate` | `getCoachInviteCode`, `rotateCoachInviteCode` | P0 |
| `POST /invites/coach/lookup` `[pub]` | `getCoachByInviteCode`, `previewCoachByInviteCode` | P0 |
| `GET /parent/invite-code` · `GET /parent/athletes/invite-codes` | `getOrCreateParentInviteCode`, `listAthletesWithInviteCodes` | P0 |
| `POST /invites/parent/lookup` `[pub]` · `POST /invites/parent/claim` | `getParentByInviteCode`, `claimParentInvite` | P0 |
| `GET /athlete/invite-code` · `POST /invites/adult-athlete/lookup` `[pub]` · `POST /invites/adult-athlete/claim` | `getOrCreateAdultAthleteInviteCode`, `getAdultAthleteByInviteCode`, `claimAdultAthleteInvite` | P0 |
| `POST /guardian/claim/summary` `[pub]` · `GET /guardian/claim/context` · `POST /guardian/claim` · `POST /guardian/claim/merge-options` · `POST /guardian/claim/merge` · `POST /guardian/claim/self` · `POST /guardian/invites/{id}/resend` · `GET /guardian/status` | `getGuardianClaimSummary`, `getGuardianClaimContext`, `claimGuardianAthlete`, `getGuardianClaimMergeOptions`, `mergeGuardianClaim`, `claimAthleteSelf`, `resendGuardianInvite`, `getMyGuardianStatus` | P1 |
| `GET /parent/team/guardians` · `POST /parent/team/guardians/invites` · `DELETE /parent/team/guardians/invites/{id}` · `DELETE /parent/team/guardians/{id}` · `POST /team-invites/preview` `[pub]` · `POST /team-invites/claim` | `listTeamGuardians`, `inviteGuardian`, `revokeGuardianInvite`, `removeGuardian`, `previewGuardianInvite`, `claimGuardianInvite` | P1 |
| `GET /coach/visibility` · `PUT /coach/visibility` · `GET /coach/visibility/mine` · `POST /coach/visibility/{id}/respond` · `DELETE /coach/visibility/{id}` | `listCoachVisibility`, `setCoachVisibility`, `listMyCoachVisibility`, `respondToCoachVisibility`, `disconnectCoachVisibility` | P1 |
| `GET /coach/athletes/{id}/other-plan` | `getOtherCoachPlanForMessage` | P0 |

### Sign-up and onboarding

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/profile` · `PUT /coach/profile` · `PUT /coach/levels` · `POST /coach/onboarding/complete` | `getCoachProfile`, `saveCoachProfile`, `saveCoachLevels`, `completeOnboarding` | P0 |
| `POST /orgs/search` · `GET /orgs/popular` · `POST /orgs/lookup-code` · `POST /orgs/verify-code` · `POST /orgs/join` · `POST /orgs/claim-code` · `DELETE /coach/org` · `POST /orgs/lead` · `POST /org-invites/resolve` · `POST /org-invites/accept` | `searchOrganizations`, `getPopularOrganizations`, `getOrganizationByInviteCode`, `verifyOrgCodeForOrg`, `joinOrganization`, `claimOrganizationInviteCode`, `clearOrganizationLink`, `recordSilentClubLead`, `resolveOrgCoachInvite`, `acceptOrgCoachInvite` (`listOrganizations`, `createOrganization`, `updateOrganization`, `rotate/setOrganizationInviteCode`, `getOrganizationStats` are admin) | P0 basic / P1 full |
| `POST /signup/parent/validate-code` `[pub]` · `POST /signup/parent/start` · `GET /signup/parent/status` · `POST /signup/parent/athletes-for-code` · `POST /signup/parent/link-coach` · `POST /signup/parent/goals` · `POST /signup/parent/schedule` | `validateSignupCode`, `startParentSignup`, `getParentSignupStatus`, `listAthletesForCode`, `linkAthletesToCoach`, `saveAthleteGoals`, `saveAthleteSchedule` | P0 |
| `POST /signup/athlete/invite-summary` `[pub]` · `POST /signup/athlete/claim` · `POST /signup/athlete/username` `[pub]` · `GET /athlete/me` | `getAthleteInviteSummary`, `claimAthleteInvite`, `signupAthleteWithUsername`, `getMyAthlete` | P0 |
| `POST /signup/adult-athlete` · `POST /adult-athlete/coach/preview` · `POST /adult-athlete/coach/link` · `GET /adult-athlete/onboarding` · `PUT /adult-athlete/goals` · `GET /adult-athlete/coaches` · `DELETE /adult-athlete/coaches/{id}` · `PUT /adult-athlete/coaches/{id}/sports` · `POST /adult-athlete/coach/sports-offered` · `GET /adult-athlete/schedules` · `PUT /adult-athlete/schedules/{coachId}` | `createSelfManagedAthlete`, `previewCoachForAdultAthlete`, `linkAdultAthleteToCoach`, `getAdultOnboardingStatus`, `saveAdultAthleteGoals`, `listAdultAthleteCoaches`, `unlinkAdultAthleteFromCoach`, `updateAdultAthleteCoachSports`, `getCoachOfferedSportsForAdult`, `getAdultAthleteSchedules`, `saveAdultAthleteScheduleForCoach` | P0 |
| `POST /coach/starter-plans/adopt` | `adoptStarterPlan` | P1 |

### Coach roster and schedule

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/roster` `[etag]` · `GET /coach/home?week=` (composite) | `getCoachRoster` (+ `getRosterPracticeSummaries`, `getPendingLessonWrapUps`, `getCoachPostEventItems`) | P0 |
| `GET /coach/roster/practice-summaries?from&to` | `getRosterPracticeSummaries` | P0 |
| `POST /coach/roster/athletes` · `DELETE /coach/roster/athletes/{athleteId}` | `addAthleteWithGuardian`, `removeAthleteFromRoster` | P0 |
| `POST /coach/lesson-slots` `[idem]` · `PATCH /coach/lesson-slots/{id}` · `DELETE /coach/lesson-slots/{id}` · `POST /coach/lesson-slots/{id}/occurrences/{date}/cancel` · `POST .../reschedule` · `DELETE .../override` | `addLessonSlot`, `updateLessonSlot`, `deleteLessonSlot`, `cancelLessonOccurrence`, `rescheduleLessonOccurrence`, `clearLessonOverride` | P0 |
| `GET /coach/athletes/{id}` · `GET /coach/athletes/{id}/ai-summary?refresh` | `getCoachAthleteDetail`, `getCoachAthleteAiSummary` | P0 |
| `PUT /coach/athletes/{id}/practice-target` · `DELETE ...` | `setPracticeTarget`, `clearPracticeTarget` | P0 |
| `GET /coach/athletes/{id}/briefing?date&refresh` | `getPreLessonBriefing` | P0 |
| `GET /coach/wrap-ups/pending` · `POST /coach/wrap-ups` `[idem]` | `getPendingLessonWrapUps`, `recordLessonWrapUp` | P0 |
| `POST /coach/schedule-import/parse` (multipart) · `POST /coach/schedule-import/commit` `[idem]` | `parseScheduleImage`, `commitScheduleImport` | P1 |
| `GET /coach/athletes` · `GET /coach/sports` | `listCoachAthletes`, `listCoachSports` | P0 |

### Plans, moves, sessions, voice

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/plans?status&athleteId&sport` `[etag]` · `POST /coach/plans` `[idem]` | `listPlans`, `createPlan` | P0 |
| `GET /plans/{id}` (role-aware) · `PUT /plans/{id}` · `PATCH /plans/{id}` · `POST /plans/{id}/status` (*2026-09-20:* optional `reason`: `landed` / `parked` / `dropped`) · `DELETE /plans/{id}` | `getPlan` / `getParentPlan` / `getAthletePlan`, `savePlan`, `updatePlan`, `setPlanStatus`, `deletePlan` | P0 |
| `POST /plans/{id}/moves` · `POST /plans/{id}/moves/from-library` · `PATCH /plans/{id}/moves/{moveId}` · `DELETE ...` (*2026-09-20:* optional `reason`, same values) · `PUT /plans/{id}/moves/order` | `addMoveToPlan`, `addLibraryMovesToPlan`, `updatePlanMove`, `removePlanMove`, `reorderPlanMoves` | P0 |
| `GET /coach/athletes/{id}/active-plans` | `getAthleteActivePlans` | P0 |
| `GET /coach/moves` `[etag]` · `PUT /coach/moves` · `POST /coach/moves/{id}/archive` · `POST /coach/moves/from-plan-move` · `POST /coach/moves/{id}/update-from-plan-move` · `POST /coach/moves/fork-from-plan-move` | `listMoves`, `upsertMove`, `archiveMove`, `addPlanMoveToLibrary`, `updateLibraryMoveFromPlanMove`, `forkPlanMoveToLibrary` | P0 |
| `GET /parent/plans?status&coachId&sport` `[etag]` · `GET /athlete/plans` `[etag]` | `listParentPlans`, `listAthletePlans` | P0 |
| `GET /plans/{id}/sessions` `[page]` · `POST /plans/{id}/sessions` `[idem]` · `GET /plans/{id}/sessions/summary` | `getPlanSessions` + `listPlanSessions`, `submitPlanSession` / `submitAthletePlanSession` (by role), `getPlanSessionsSummary` | P0 |
| `POST /voice/transcribe` (multipart) · `POST /voice/build-plan` | `voiceTranscribe`, `voiceBuildPlan` | P0 |
| `POST /plans/{id}/share-token` · `GET /public/plans/{token}` `[pub]` · `POST /plans/import/{token}` | `getOrCreateShareToken`, `getSharedPlanPublic`, `importSharedPlan` | P1 |

### Messaging and safety

| Endpoint | Source | Pri |
|---|---|---|
| `GET /rooms` `[etag]` · `GET /rooms/{id}` `[page]` · `POST /rooms/{id}/messages` `[idem]` · `POST /rooms/{id}/read` · `GET /messages/unread-total` · `GET /rooms/{id}/active-plans` · `GET /message-targets` · `POST /rooms/ensure` (discriminated body) | `listMyRooms`, `getRoom`, `sendMessage`, `markRoomRead`, `getUnreadTotal`, `getRoomActivePlans`, `listMyMessageTargets`, `ensureRoom` / `ensureRoomForAthlete` / `ensureDirectRoom` / `ensureRoomForTarget` | P0 |
| voice-note upload | direct to Storage `voice-notes/{roomId}/{uuid}.m4a` (RLS) | P0 |
| `POST /safety/blocks` · `DELETE /safety/blocks/{userId}` · `GET /safety/blocks` · `POST /safety/reports` `[idem]` | `blockUser`, `unblockUser`, `listMyBlocks`, `submitReport` (`adminListReports`, `adminUpdateReportStatus` are admin) | P0 |

### Parent and athlete settings

| Endpoint | Source | Pri |
|---|---|---|
| `GET /parent/settings` `[etag]` · `PATCH /parent/profile` · `POST /parent/athletes` · `PATCH /parent/athletes/{id}` · `DELETE /parent/athletes/{id}` · `PUT /parent/athletes/{id}/goals` · `POST /parent/athletes/{id}/reset-password` · `POST /parent/athletes/{id}/coaches` · `DELETE /parent/athletes/{id}/coaches/{coachId}` · `PUT .../coaches/{coachId}/sports` · `PUT /parent/athletes/{id}/primary-coach` · `PUT /parent/athletes/{id}/schedule` | `getParentSettings`, `updateParentProfile`, `addAthlete`, `updateAthlete`, `removeAthlete`, `updateAthleteGoals`, `resetAthletePassword`, `linkAthleteToCoach`, `unlinkAthleteFromCoach`, `updateCoachAthleteSports`, `setPrimaryCoach`, `replaceAthleteSchedule` | P0 |
| `GET /parent/goals` | `getParentGoalsDashboard` | P0 |
| `GET /parent/team` | `getTeamPlanStatus` | P0 (display) |
| `GET /athlete/settings` · `PATCH /athlete/me` · `GET /athlete/goals` · `PUT /athlete/goals/long-term` · `PUT /athlete/goals/motivation` | `getAthleteSettings`, `updateAthleteSelf`, `getAthleteGoalsDashboard`, `updateAthleteLongTermGoal`, `updateAthleteMotivation` | P0 |

### Resources and Ask Gradus

| Endpoint | Source | Pri |
|---|---|---|
| `GET /resources` (role-aware) · `POST /resources/{id}/signed-url` · `POST /coach/resources` · `POST /coach/resources/upload-url` · `DELETE /coach/resources/{id}` | `getParentResources` / `getAthleteResources` / `listCoachResources`, `getResourceSignedUrl`, `createCoachResource`, `createCoachResourceUploadUrl`, `deleteCoachResource` | P1 |
| `POST /ask` (*2026-09-20:* response adds `grounded` and `sources[]`) · `GET /saved-answers` · `POST /saved-answers` · `DELETE /saved-answers/{id}` | `askGradus`, `listSavedAnswers`, `saveAnswer`, `deleteSavedAnswer` | P1 |

### Live Board and competitions

| Endpoint | Source | Pri |
|---|---|---|
| `GET /public/boards` `[pub]` · `GET /public/boards/{slug}` `[pub][etag]` · `GET /boards/my-skaters` | `listBoards`, `getBoard`, `getMySkaterNames` | P0 |
| `PUT /boards/{slug}/follows` · `DELETE /boards/{slug}/follows/{name}` | new (`board_follows`) | P0 |
| `POST /competitions/{id}/attendance` | `recordCompetitionAttendance` | P0 |
| `GET /recaps/pending` · `POST /recaps/{id}/dismiss` · `GET /recaps/coaches?athleteId` · `POST /recaps` `[idem]` · `GET /athletes/{id}/recaps` | `getPendingCompetitionRecap`, `dismissCompetitionRecap`, `getRecapCoaches`, `submitCompetitionRecap`, `getAthleteCompetitionRecaps` | P1 |
| `GET /competitions/finished` · `POST /competitions/{id}/skater-matches` · `POST /athletes/{id}/competition-links` · `DELETE /athletes/{id}/competition-links/{linkId}` · `GET /athletes/{id}/competition-results` · `POST /athletes/{id}/competition-results/{resultId}/generate-plan` · `GET /coach/post-event` · `POST /coach/post-event/{id}/dismiss` · `GET /coach/competitions/{id}/roster` | `listFinishedCompetitions`, `listSkaterMatches`, `linkAthleteToSkater`, `unlinkAthleteCompetition`, `getAthleteCompetitionResults`, `generatePlanFromResults`, `getCoachPostEventItems`, `dismissCoachPostEvent`, `listCoachRosterForCompetition` | P1 |

### Billing and invoicing

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/billing` (entitlement summary) | derived from `getCoachProfile` | P0 |
| `POST /coach/founding/claim` · `POST /coach/founding/restore` | `claimFoundingCoachTier`, `restoreFoundingCoachTier` | P1 |
| — (web only) | `startCoachCheckout`, `createCoachBillingPortalSession`, `changeCoachSubscription`, `verifyCheckoutSession`, `startTeamCheckout`, `createParentBillingPortalSession` | never |
| `PUT /coach/athletes/{id}/rate` · `GET /coach/invoices` `[page]` · `GET /coach/athletes/{id}/billing` · `GET /coach/invoices/{id}` · `POST /coach/invoices/preview` · `POST /coach/invoices` `[idem]` · `PATCH /coach/invoices/{id}/status` · `DELETE /coach/invoices/{id}` | `setAthleteRate`, `getCoachInvoices`, `getAthleteBilling`, `getInvoiceDetail`, `previewInvoice`, `createInvoice`, `setInvoiceStatus`, `deleteInvoice` | P1 |

---

## Appendix B — Tables by domain and what iOS caches

| Domain | Tables | Cached on iOS |
|---|---|---|
| Identity and roles | `coach_profiles`, `parent_profiles`, `athletes`, `user_roles`, `org_admins`, `admin_allowlist`, `terms_acceptances`, `soft_deleted_users`, `deleted_accounts`, new `auth_identities` | Own profile summary via `/me` |
| Connections and invites | `coach_athletes`, `coach_athlete_sports`, `athlete_primary_coaches`, `athlete_guardians`, `guardian_invites`, `coach_invite_codes`, `parent_invite_codes`, `athlete_invite_codes`, `adult_athlete_invite_codes`, `invite_lookup_attempts`, `athlete_coach_visibility`, `coach_visibility_links` | Roster and coach lists (derived DTOs) |
| Organizations | `organizations`, `organization_invite_codes`, `organization_leads`, `org_coach_invites`, `org_admin_actions` | Own org name only |
| Schedule | `athlete_lesson_slots`, `lesson_slot_overrides`, `lesson_wrap_ups`, `coach_athlete_practice_targets`, `pre_lesson_briefings` | Slots and overrides for ±8 weeks; briefings as fetched |
| Plans | `plans`, `plan_moves`, `moves`, `seed_moves`, `plan_sessions`, `athlete_goals`, new `athlete_skill_events`, new `athlete_goals_history` (PR #129) | All own plans and moves; sessions for opened plans; skill events and goals history are read only through the profile, not cached |
| Messaging | `message_rooms`, `direct_rooms`, `messages`, `message_reads`, `user_blocks`, `user_reports` | Rooms; newest 200 messages per room; blocks |
| Resources and AI | `resources`, `resource_sports`, `parent_saved_answers`, new `knowledge_sources`, new `knowledge_chunks` | Lists; downloaded PDFs; saved answers with their sources; knowledge tables are server-only |
| Competitions | `competitions`, `competition_snapshots`, `competition_attendance`, `competition_recaps`, `athlete_competition_results`, `athlete_competition_skaters`, new `board_follows`, new `live_activity_tokens` | Board history and follows; last snapshot per visited board |
| Billing | `billing_events`, `coach_athlete_rates`, `invoices`, `invoice_lines`, `promo_codes`, `user_applied_promo_codes` | Entitlement summary; invoices for opened athletes |
| Platform | `device_tokens`, `client_errors`, `error_group_explanations`, `feedback`, `impersonation_events`, new `api_idempotency_keys` | Nothing |
| Email (server only) | `email_send_log`, `email_send_state`, `email_template_overrides`, `email_template_override_history`, `email_unsubscribe_tokens`, `lifecycle_email_jobs`, `suppressed_emails` | Nothing |

---

## Appendix C — Web route → iOS screen

Size: S < 200 lines, M 200–500, L 500–1000, XL > 1000 lines of TSX in the web route (components excluded).

| Web route | iOS screen (module) | Size | Pri |
|---|---|---|---|
| `/` (role picker / redirect) | Launch router → role home | S | P0 |
| `/login`, `/forgot-password`, `/reset-password` | `SignInView`, `ForgotPasswordView` (FeatureAuth) | M | P0 |
| `/signup/coach` | `CoachSignUpView` | M | P0 |
| `/signup/parent`, `/signup/parent/athletes`, `/goals`, `/schedule` | `ParentSignUpFlow` (4 steps) | L total | P0 |
| `/signup/athlete`, `/confirm`, `/account`, `/signup/athlete/adult` | `AthleteSignUpFlow`, `AdultAthleteSignUpView` | M | P0 |
| `/i/:code` | `InviteEntryView` | M | P0 |
| `/g/:token`, `/team/:token` | `GuardianClaimFlow`, `TeamInviteView` | M | P1 |
| `/p/:token` | `SharedPlanView` | M | P1 |
| `/coach` (redirect), `/coach/onboarding` | `CoachOnboardingFlow` | M | P0 |
| `/coach/roster` (+ `week-schedule-view`, `lesson-slot-sheet`, `athlete-detail-sheet`, `roster-card`, `schedule-import-sheet`) | `RosterView`, `WeekScheduleView`, `LessonSlotEditor`, `AthleteDetailView`, `ScheduleImportFlow` (FeatureRoster) | M route + 3.5k components | P0 (import P1) |
| `/coach/plans`, `/coach/plans/:planId` (+ `move-sheet`, `move-field`, `voice-fab`) | `PlansListView`, `PlanDetailView`, `PlanEditor`, `MoveLibraryView`, `VoiceCaptureView` (FeaturePlans, FeatureVoice) | XL | P0 |
| `/coach/messages`, `/coach/messages/:roomId` (shared with parent and athlete) | `RoomsListView`, `RoomView`, `NewConversationView` (FeatureMessages) | M + 1k components | P0 |
| `/coach/resources` | `ResourcesView` (coach variant with upload) | M | P1 |
| `/coach/settings`, `/coach/settings/account` | `SettingsView` (coach), `AccountSecurityView` | L | P0 |
| `/coach/paywall` | **Web only**; app shows `PlanStatusView` | XL (web) | — |
| `/parent` (redirect), `/parent/plans`, `/parent/plans/:planId` | `RunnerPlansView`, `RunnerPlanDetailView`, `SessionTimerView`, `SessionFeedbackSheet` (FeatureSessions) | M | P0 |
| `/parent/settings`, `/parent/settings/account` | `SettingsView` (parent) with athlete, coach, goals, schedule editors | XL | P0 (team P1) |
| `/parent/team` | `TeamPlanView` (guardians; billing link) | M | P1 |
| `/parent/resources` | `ResourcesView`, `AskGradusView`, `SavedAnswersView` | M | P1 |
| `/athlete` (redirect), `/athlete/onboarding` | `AthleteOnboardingFlow` | L | P0 |
| `/athlete/plans`, `/athlete/plans/:planId` | shared runner views + `MotivationCard` | M | P0 |
| `/athlete/settings`, `/athlete/settings/account` | `SettingsView` (athlete) | L | P0 |
| `/athlete/resources` | `SafeSportPanel` (P0), `AskGradusView` (P1) | M | P0 / P1 |
| `/board`, `/board/:slug` (+ 14 board components) | `BoardIndexView`, `BoardView`, `RinkPanel`, `ScheduleBoard`, `FollowingView`, `ScoreSheetView`, `EventResultsView`; `BoardLiveActivity`, `BoardWidget` (FeatureBoard, GradusWidgets) | M + 2k components | P0 (widget P1) |
| `/privacy`, `/terms` | Open in Safari from Settings → Legal | — | P0 |
| `/admin/*`, `/org-admin/*`, `/dev/*`, `/email/*`, `/lovable/*`, `/api/*` | Not in app | — | — |

---

## Appendix D — App Store submission checklist

Carried over from `docs/mobile/submission.md` and updated for the native app.

**One submission (amended 2026-09-19).** The native app is the only iOS submission, at version 1.0. Nothing from the shell plan applies: no Capacitor Sign in with Apple plugin, no welcome screen for a one-time sign-in, no version ordering against 1.x builds. The Android shell notes in `docs/mobile/submission.md` stay until §12 #14 is decided.

**Before enrollment completes (do now)**
- [ ] App name, subtitle, keywords, description, support URL, marketing URL, privacy policy URL (`https://www.gradussports.com/privacy`).
- [ ] 6.7" and 6.5" screenshots from the simulator once P0 screens exist; App Preview video optional.
- [ ] App Privacy questionnaire answers matching the policy (athlete email and commercial information are the load-bearing answers; add Diagnostics for crash reports).
- [ ] Review notes draft (below) and demo accounts confirmed working: `mariah.slone+1@gmail.com` (parent) and `alyson.stemas@gmail.com` (coach); add a demo athlete username.
- [ ] Age rating questionnaire (no Kids Category).
- [ ] Decide storefront availability (default US only).

**At App Store Connect setup (enrollment approved 2026-09-19)**
- [ ] App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple, and App Groups (`group.training.gradus.app`, shared with the widget's App ID `training.gradus.app.widgets`).
- [ ] APNs key (`.p8`, Key ID), Sign in with Apple key (`.p8`, Key ID), Team ID → Lovable Cloud secrets `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_SIWA_KEY_ID`; the Team ID also goes into gradus-ios `project.yml` and the AASA file.
- [ ] `apple-app-site-association` published with the Team ID and the paths in §6.10; verify with Apple's CDN check.
- [ ] Xcode Cloud workflow; internal TestFlight group.
- [ ] Live Activities frequent updates: already declared in Info.plist (`NSSupportsLiveActivitiesFrequentUpdates`); nothing to request.

**Review notes (draft)**
1. Gradus is a multiplatform coaching service. Coach and Team subscriptions are purchased on our website; the app unlocks access to previously purchased subscriptions. There is no purchase flow in the app. On the US storefront the app links to our website to manage a plan, per Guideline 3.1.1(a); no entitlement is required.
2. Coaches can create invoices for lessons they teach in person; this is a real-world service consumed outside the app (Guideline 3.1.3(e)). No payment is processed in the app.
3. Sign in with Apple is offered alongside Google and email sign-in (Guideline 4.8).
4. User-generated content: every conversation offers Report and Block; blocked users are hidden immediately (Guideline 1.2).
5. Account deletion is in Settings → Account & security → Delete account (Guideline 5.1.1(v)); it deletes the account and revokes the Sign in with Apple token.
6. The app collects a guardian email for athletes under 18; athlete accounts are created by parents and sign in with a username. We are not in the Kids Category.
7. Demo accounts are in the notes field; a live competition board is available at the URL provided (or the demo board if no competition is running).

**Before each submission**
- [ ] Version and build bumped; release notes written.
- [ ] `docs/ios/QA.md` checklist run on a real device with airplane mode scenarios.
- [ ] Crash-free rate on the last TestFlight build ≥ 99.5%.
- [ ] Web guardrails (§2) unchanged since the last backend publish.

---

## Appendix E — Glossary

| Term | Meaning |
|---|---|
| **Plan** | A coach-authored practice plan: title, athlete, notes, ordered moves; status active, draft, benched, or template |
| **Move** | One exercise in a plan or a coach's library: name, category, sport, what / how (cue) / why, target reps or minutes |
| **Session** | One logged practice run of a plan by a parent or athlete, with duration and a flow state |
| **Flow state** | Five-point rating: Frustrated, Pushing, Steady, Locked in, Flowing |
| **Lesson slot** | A recurring lesson between a coach and athlete (weekly, biweekly, twice monthly, monthly) with per-date overrides |
| **Wrap-up** | The post-lesson prompt asking the coach to edit, redeploy, or dismiss |
| **Briefing** | AI narrative for a coach before a lesson, built from plans, sessions, and messages since the last lesson |
| **Room** | A message thread: three-way (coach, parent, athlete) or direct (coach–coach, coach–parent) |
| **Guardian** | A parent-role account linked to an athlete; up to three per athlete on the Team plan |
| **Founding Coach** | A coach onboarded before 2026-11-01; free for life |
| **Live Board** | Public competition scoreboard built from IJS results; lanes are Just scored, On the ice (inferred), Up next |
| **Snapshot** | The cached board payload one Worker refresh produces for all viewers |
| **Broker** | A server endpoint that verifies a third-party identity token and mints a Supabase session |
| **Outbox** | The on-device queue of pending mutations, drained when online |
| **Sync Center** | Settings screen listing pending or failed changes with retry and discard |

---

## Appendix F — Work packages (scope reference)

The package numbers used by the milestones in §10.2 and by the briefs in `docs/ios/briefs/`. Scope only; no sizing.

**Phase 0 — Backend API (this repo)** — Web untouched; deploys via Lovable publish

- **0.1** API scaffolding: routing, auth middleware, error shape, idempotency table, rate limiting, OpenAPI registry, kill switch, `/meta/*`, `/me` composite
- **0.2** Auth broker: Apple, Google, password (email or username), coach sign-up, recover; `auth_identities`; Apple token revocation on delete (Needs the Sign in with Apple key to test revocation)
- **0.3** Extract and expose: messages, plans and moves, roster and schedule, sessions, settings (3 roles), invites and sign-up flows (Largest refactor; one PR per domain)
- **0.4** Extract and expose: board, competitions and recaps, resources and Ask Gradus, invoicing, guardians and team, visibility, org join, voice (accept `audio/mp4`)
- **0.5** APNs sender, triggers in shared functions, token pruning, `board_follows`, `live_activity_tokens`, push-to-start for boards (Send path testable only after enrollment)

**Phase 1 — iOS foundation** — Can run in parallel with Phase 0 after 0.1

- **1.1** Create `gradus-ios`; Xcode project, SPM packages, contract sync script, macOS CI, Xcode Cloud, color catalog generation, fonts, core components
- **1.2** Generated API client, interceptors, client policy, error mapping
- **1.3** Auth screens: sign in, Apple, Google, password and username, Keychain, biometric gate, terms sheet
- **1.4** Local store, repositories, outbox, sync engine, connectivity, Sync Center
- **1.5** App shell: tabs per role, routing, universal links, push registration and routing, error states, force-update

**Phase 2 — P0 features**

- **2.1** Sign-up and onboarding for coach, parent, minor athlete, adult athlete; invite entry
- **2.2** Coach roster: segments, week schedule, lesson slot sheet, recurrence port with shared vectors, add and remove athlete, invite code, roster settings, practice targets
- **2.3** Athlete detail with AI summary; pre-lesson briefing; lesson wrap-ups
- **2.4** Plans: list and filters, detail and editor, move library, templates, status rules, sessions view, AI session summary (Biggest screen in the app)
- **2.5** Voice FAB end to end with offline capture
- **2.6** Messaging: rooms, thread with pagination, realtime, composer, voice notes (record, play, WebM fallback), plan tags, new conversation, report and block
- **2.7** Sessions: runner plan detail, timer, Live Activity, feedback, persistent active bar
- **2.8** Parent settings: athletes, coaches, primary coach, goals, schedule editor, reset athlete password; goals dashboard
- **2.9** Athlete: plans, goals and motivation, coaches; Safe Sport panel
- **2.10** Common settings: profile, appearance, account and security with deletion, device, legal, feedback, plan status with US link, sign out
- **2.11** Live Board: index, board with three tabs, rink panel and lanes, score sheet, results, schedule, follow search, history, attendance, universal link and QR
- **2.12** Live Activity and Dynamic Island for the board, including server push-to-start
- **2.13** Offline hardening across features: per-entity policies, queued mutations, conflict UX, background refresh
- **2.14** Push: content, routing, badges, permission UX; end-to-end QA of triggers

**Phase 3 — P1 features** — Part of native 2.0

- **3.1** Resources: library, PDF viewer, coach upload, report a resource
- **3.2** Ask Gradus and saved answers
- **3.3** Invoicing: rates, preview, create, detail, status, share
- **3.4** Competition results linking, post-event prompt, plan from results, recap prompt and sheet, recap messages
- **3.5** Guardian claims, team guardians, connection celebration, coach visibility management, athlete guardian
- **3.6** Schedule import with camera and AI review
- **3.7** Plan share and import, starter programs, Founding tier claim, connections hub, in-app password reset
- **3.8** Home Screen widget, lesson reminders, App Attest
- **3.9** Web voice-note format preference; the Capacitor iOS removal PR (can merge any time since 2026-09-19; the 2.0 welcome screen is no longer needed)
- **3.10** *(2026-09-20)* Skill events, the coach "why" prompt, protocol-derived events; level history comes from `athlete_goals_history` (L1, L2)
- **3.11** *(2026-09-20)* Athlete profile, inference job, profile-fed prompts, sport-aware plan drafting from full results history (L3)
- **3.12** *(2026-09-20)* Knowledge corpus, ingestion path, grounded Ask Gradus with citations and safety routing, iOS sources UI (L4, L5)
- **3.13** *(2026-09-20)* Learned pace model, post-launch (L6)

**Phase C — Capacitor iOS 1.0 to the App Store** — **Dropped 2026-09-19** (no shell ships)

- **C.1** Sign in with Apple in the shell via the broker; App ID, certificates, APNs and Sign in with Apple keys; AASA with Team ID
- **C.2** Listing, screenshots, App Privacy answers, review notes; archive, TestFlight sanity, submit; one review round

**Phase D — Capacitor Android 1.0 to Google Play** — **Reopened 2026-09-19** (§12 #14)

- **D.1** JDK 17 and Android Studio, `cap add android`, icons and splash, keystore and Play App Signing, AAB, Play listing and Data safety, `assetlinks.json` with the Play SHA-256, one review round (Keep the upload key backed up)

**Phase 4 — Hardening and launch (native 2.0)**

- **4.1** Accessibility and Dynamic Type pass, performance, iPad layouts, QA checklist runs, TestFlight feedback, screenshots, privacy labels, review notes, submission (Plus App Review wait (typically 1–7 days, allow two rounds)). *2026-09-19:* the accessibility pass is pulled forward into the §10.6 gate (P5–P8) and the QA checklist into P9.

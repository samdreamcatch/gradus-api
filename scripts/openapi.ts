/**
 * Regenerates docs/api/openapi.json from the zod schemas registered by the
 * /api/v1 route modules. Run with `bun run openapi`. CI re-runs this and
 * fails the build if the committed file would change (see
 * .github/workflows/node.js.yml), per docs/ios/PRD.md §6.2 / §9.4.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "../src/lib/api/openapi";

// Importing each route module for its registration side effect
// (defineApiRoute calls registerApiRoute at module load time).
import "../src/routes/api/v1/meta/config";
import "../src/routes/api/v1/meta/client-policy";
import "../src/routes/api/v1/me/index";
import "../src/routes/api/v1/me/presence";
import "../src/routes/api/v1/me/terms";
import "../src/routes/api/v1/me/terms_.accept";
import "../src/routes/api/v1/coach/profile";
import "../src/routes/api/v1/coach/levels";
import "../src/routes/api/v1/coach/onboarding/complete";
import "../src/routes/api/v1/coach/invite-code/index";
import "../src/routes/api/v1/coach/invite-code/rotate";
import "../src/routes/api/v1/coach/org";
import "../src/routes/api/v1/invites/resolve";
import "../src/routes/api/v1/invites/parent/preview";
import "../src/routes/api/v1/invites/parent/claim";
import "../src/routes/api/v1/invites/adult-athlete/preview";
import "../src/routes/api/v1/invites/adult-athlete/claim";
import "../src/routes/api/v1/promo-codes/validate";
import "../src/routes/api/v1/me/promo-code";
import "../src/routes/api/v1/orgs/search";
import "../src/routes/api/v1/orgs/popular";
import "../src/routes/api/v1/orgs/lookup-code";
import "../src/routes/api/v1/orgs/verify-code";
import "../src/routes/api/v1/orgs/claim-code";
import "../src/routes/api/v1/orgs/join";
import "../src/routes/api/v1/orgs/lead";
import "../src/routes/api/v1/auth/signup/parent";
import "../src/routes/api/v1/auth/signup/adult-athlete";
import "../src/routes/api/v1/signup/parent/validate-code";
import "../src/routes/api/v1/signup/parent/start";
import "../src/routes/api/v1/signup/parent/status";
import "../src/routes/api/v1/signup/parent/coach-preview";
import "../src/routes/api/v1/signup/parent/athletes-for-code";
import "../src/routes/api/v1/signup/parent/link-coach";
import "../src/routes/api/v1/signup/parent/goals";
import "../src/routes/api/v1/signup/parent/schedule";
import "../src/routes/api/v1/parent/invite-code";
import "../src/routes/api/v1/auth/apple";
import "../src/routes/api/v1/auth/google";
import "../src/routes/api/v1/auth/password";
import "../src/routes/api/v1/auth/recover";
import "../src/routes/api/v1/auth/signup/coach";
import "../src/routes/api/v1/auth/username/resolve";
import "../src/routes/api/v1/auth/username/check";
import "../src/routes/api/v1/public/boards/index";
import "../src/routes/api/v1/public/boards/$slug";
import "../src/routes/api/v1/boards/my-skaters";
import "../src/routes/api/v1/boards/$slug/follows/index";
import "../src/routes/api/v1/boards/$slug/follows/$name";
import "../src/routes/api/v1/competitions/$id/attendance";
import "../src/routes/api/v1/rooms/index";
import "../src/routes/api/v1/rooms/ensure";
import "../src/routes/api/v1/rooms/$id/index";
import "../src/routes/api/v1/rooms/$id/messages";
import "../src/routes/api/v1/rooms/$id/read";
import "../src/routes/api/v1/rooms/$id/active-plans";
import "../src/routes/api/v1/messages/unread-total";
import "../src/routes/api/v1/message-targets";
import "../src/routes/api/v1/safety/blocks/index";
import "../src/routes/api/v1/safety/blocks/$userId";
import "../src/routes/api/v1/safety/reports";

const outPath = resolve(__dirname, "../docs/api/openapi.json");
mkdirSync(dirname(outPath), { recursive: true });

const document = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");

console.log(`Wrote ${outPath}`);

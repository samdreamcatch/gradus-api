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
import "../src/routes/api/v1/me/presence";
import "../src/routes/api/v1/me/terms";
import "../src/routes/api/v1/auth/apple";
import "../src/routes/api/v1/auth/google";
import "../src/routes/api/v1/auth/password";
import "../src/routes/api/v1/auth/recover";
import "../src/routes/api/v1/auth/signup/coach";
import "../src/routes/api/v1/auth/username/resolve";
import "../src/routes/api/v1/auth/username/check";

const outPath = resolve(__dirname, "../docs/api/openapi.json");
mkdirSync(dirname(outPath), { recursive: true });

const document = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");

console.log(`Wrote ${outPath}`);

/**
 * OpenAPI 3.1 registry and document builder for `/api/v1`, per
 * docs/ios/PRD.md §6.2 and §9.4. Every route registers itself here through
 * `defineApiRoute` (see define-route.ts). `scripts/openapi.ts` imports the
 * route modules (for the registration side effect) and calls
 * `buildOpenApiDocument()` to write `docs/api/openapi.json`.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodType } from "zod";

extendZodWithOpenApi(z);

export const apiRegistry = new OpenAPIRegistry();

apiRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Supabase access token",
});

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ApiError");

export interface RegisterRouteOptions {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  summary: string;
  auth: "user" | "public";
  input?: ZodType;
  output: ZodType;
}

export function registerApiRoute(route: RegisterRouteOptions): void {
  apiRegistry.registerPath({
    method: route.method,
    path: route.path,
    summary: route.summary,
    security: route.auth === "user" ? [{ bearerAuth: [] }] : [],
    request: route.input
      ? { body: { content: { "application/json": { schema: route.input } } } }
      : undefined,
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: route.output } },
      },
      default: {
        description: "Error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  });
}

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(apiRegistry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Gradus API",
      version: "1.0.0",
      description: "Gradus /api/v1 — see docs/api/README.md and docs/ios/PRD.md §6.2.",
    },
    servers: [{ url: "https://gradus.training" }],
  });
}

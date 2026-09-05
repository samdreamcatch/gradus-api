/**
 * Narrow local shim for the `bun:test` types used in this directory's
 * tests. Deliberately not the `@types/bun` package: it declares a global
 * `fetch` that conflicts with the one `src/lib/stripe.server.ts` expects
 * from `@types/node`, which would break `bun run typecheck` project-wide.
 */
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;

  interface Expectation {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    not: Expectation;
  }

  export function expect(actual: unknown): Expectation;
}

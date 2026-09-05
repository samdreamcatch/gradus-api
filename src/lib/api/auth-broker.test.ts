import { describe, expect, it } from "bun:test";
import {
  checkUsernameLookupRate,
  findOrCreateIdentityUser,
  getUserEmail,
  lookupAthleteEmailByUsername,
  mintSessionForEmail,
  resolveSignInEmail,
  syntheticEmailForAthlete,
  usernameSchema,
} from "./auth-broker";
import type { ApiContext } from "./auth";

interface FakeAdminOptions {
  identities?: Record<string, { user_id: string }>;
  athletesByUsername?: Record<string, { id: string }>;
  confirmedUserByEmail?: Record<string, string>;
  usersById?: Record<string, { email: string | null }>;
  rateLimitReturn?: number;
  generateLinkHashedToken?: string;
}

function createFakeAdmin(opts: FakeAdminOptions = {}) {
  const identities: Record<string, { user_id: string }> = { ...opts.identities };
  let createdCount = 0;

  const admin = {
    from(table: string) {
      if (table === "athletes") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({
                data: opts.athletesByUsername?.[val] ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "auth_identities") {
        return {
          select: () => ({
            eq: (_c1: string, provider: string) => ({
              eq: (_c2: string, sub: string) => ({
                maybeSingle: async () => ({
                  data: identities[`${provider}:${sub}`] ?? null,
                  error: null,
                }),
              }),
            }),
          }),
          insert: async (row: { user_id: string; provider: string; provider_sub: string }) => {
            identities[`${row.provider}:${row.provider_sub}`] = { user_id: row.user_id };
            return { data: null, error: null };
          },
          update: () => ({
            eq: () => ({ eq: async () => ({ error: null }) }),
          }),
        };
      }
      throw new Error(`fake admin: unexpected table ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "find_confirmed_user_by_email") {
        return { data: opts.confirmedUserByEmail?.[args._email as string] ?? null, error: null };
      }
      if (fn === "record_invite_lookup_attempt") {
        return { data: opts.rateLimitReturn ?? 1, error: null };
      }
      throw new Error(`fake admin: unexpected rpc ${fn}`);
    },
    auth: {
      admin: {
        createUser: async (params: { email: string }) => {
          createdCount += 1;
          return {
            data: { user: { id: `new-user-${createdCount}`, email: params.email } },
            error: null,
          };
        },
        getUserById: async (id: string) => ({
          data: { user: { email: opts.usersById?.[id]?.email ?? null } },
          error: null,
        }),
        generateLink: async () => ({
          data: { properties: { hashed_token: opts.generateLinkHashedToken ?? "test-hash" } },
          error: null,
        }),
      },
    },
  };

  return admin as unknown as ApiContext["admin"];
}

describe("usernameSchema / syntheticEmailForAthlete", () => {
  it("lowercases and trims a valid username", () => {
    expect(usernameSchema.parse("  SkaterKid_1  ")).toBe("skaterkid_1");
  });

  it("rejects an invalid username", () => {
    expect(() => usernameSchema.parse("a")).toThrow();
    expect(() => usernameSchema.parse("has spaces")).toThrow();
  });

  it("builds the synthetic email for an athlete id", () => {
    expect(syntheticEmailForAthlete("abc-123")).toBe("athlete-abc-123@users.gradus.training");
  });
});

describe("lookupAthleteEmailByUsername / resolveSignInEmail", () => {
  it("resolves a known username to its synthetic email", async () => {
    const admin = createFakeAdmin({ athletesByUsername: { skaterkid: { id: "athlete-1" } } });
    expect(await lookupAthleteEmailByUsername(admin, "skaterkid")).toBe(
      "athlete-athlete-1@users.gradus.training",
    );
  });

  it("returns null for an unknown username", async () => {
    const admin = createFakeAdmin();
    expect(await lookupAthleteEmailByUsername(admin, "nobody")).toBeNull();
  });

  it("passes an email-shaped identifier through unchanged", async () => {
    const admin = createFakeAdmin();
    expect(await resolveSignInEmail(admin, "coach@example.com")).toBe("coach@example.com");
  });

  it("resolves a username-shaped identifier via the athletes table", async () => {
    const admin = createFakeAdmin({ athletesByUsername: { skaterkid: { id: "athlete-1" } } });
    expect(await resolveSignInEmail(admin, "SkaterKid")).toBe(
      "athlete-athlete-1@users.gradus.training",
    );
  });
});

describe("checkUsernameLookupRate", () => {
  it("passes when under the limit", async () => {
    const admin = createFakeAdmin({ rateLimitReturn: 3 });
    await expect(checkUsernameLookupRate(admin, "1.2.3.4", "u:test")).resolves.toBeUndefined();
  });

  it("throws rate_limited when the RPC returns the -1 sentinel", async () => {
    const admin = createFakeAdmin({ rateLimitReturn: -1 });
    await expect(checkUsernameLookupRate(admin, "1.2.3.4", "u:test")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });
});

describe("findOrCreateIdentityUser", () => {
  it("returns the linked user for a known identity", async () => {
    const admin = createFakeAdmin({ identities: { "apple:sub-1": { user_id: "user-1" } } });
    const result = await findOrCreateIdentityUser(admin, {
      provider: "apple",
      providerSub: "sub-1",
      email: "user@example.com",
    });
    expect(result).toEqual({ userId: "user-1", isNewUser: false });
  });

  it("links a confirmed existing user found by email", async () => {
    const admin = createFakeAdmin({ confirmedUserByEmail: { "user@example.com": "user-2" } });
    const result = await findOrCreateIdentityUser(admin, {
      provider: "google",
      providerSub: "sub-2",
      email: "user@example.com",
    });
    expect(result).toEqual({ userId: "user-2", isNewUser: false });

    // Second call with the same identity now hits the auth_identities link,
    // not the email match, and returns the same user.
    const second = await findOrCreateIdentityUser(admin, {
      provider: "google",
      providerSub: "sub-2",
      email: "user@example.com",
    });
    expect(second).toEqual({ userId: "user-2", isNewUser: false });
  });

  it("creates a brand-new user when nothing matches", async () => {
    const admin = createFakeAdmin();
    const result = await findOrCreateIdentityUser(admin, {
      provider: "apple",
      providerSub: "sub-3",
      email: "new@example.com",
    });
    expect(result.isNewUser).toBe(true);
    expect(result.userId).toBeDefined();
  });

  it("throws identity_email_required when there's no email and no existing match", async () => {
    const admin = createFakeAdmin();
    await expect(
      findOrCreateIdentityUser(admin, { provider: "apple", providerSub: "sub-4", email: null }),
    ).rejects.toMatchObject({ status: 422, code: "identity_email_required" });
  });
});

describe("getUserEmail", () => {
  it("returns the account's current email", async () => {
    const admin = createFakeAdmin({ usersById: { "user-1": { email: "current@example.com" } } });
    expect(await getUserEmail(admin, "user-1")).toBe("current@example.com");
  });
});

describe("mintSessionForEmail", () => {
  it("mints a session via generateLink + verify", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    const admin = createFakeAdmin({ generateLinkHashedToken: "the-hashed-token" });
    let capturedBody: unknown;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const session = await mintSessionForEmail(admin, "user@example.com", { fetchImpl });
    expect(session).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
    expect(capturedBody).toEqual({ type: "magiclink", token_hash: "the-hashed-token" });
  });
});

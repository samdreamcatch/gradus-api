import { describe, expect, it } from "bun:test";
import * as React from "react";
import { render } from "@react-email/render";
import {
  getGuardianClaimMergeOptions,
  listMyPendingGuardianClaims,
  providerVerifiedEmail,
} from "./guardian-claim.server";
import { GuardianInviteEmail } from "./email-templates/guardian-invite";
import { GuardianActivityEmail } from "./email-templates/guardian-activity";

type Row = Record<string, any>;

/** Just enough of the client for the pending-claims query. */
function fakeAdmin(
  tables: Record<string, Row[]>,
  user: {
    email?: string;
    email_confirmed_at?: string | null;
    identities?: Array<{ provider: string; identity_data?: Record<string, unknown> }>;
  } | null,
) {
  function query(table: string, filters: Array<(r: Row) => boolean>): any {
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    return {
      select: () => query(table, filters),
      eq: (c: string, v: unknown) => query(table, [...filters, (r) => r[c] === v]),
      is: (c: string, v: null) => query(table, [...filters, (r) => (r[c] ?? null) === v]),
      not: (c: string, _op: "is", v: null) =>
        query(table, [...filters, (r) => (r[c] ?? null) !== v]),
      order: () => query(table, filters),
      limit: () => query(table, filters),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
  }
  return {
    from: (table: string) => query(table, []),
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
  } as any;
}

/** An account whose address Google verified. */
const google = (email: string) => ({
  email,
  email_confirmed_at: "2026-10-01T00:00:00Z",
  identities: [{ provider: "google", identity_data: { email, email_verified: true } }],
});

const athlete = (over: Row = {}) => ({
  id: "ath-1",
  user_id: null,
  first_name: "Linnea",
  last_name: "Corwin",
  guardian_email: "renata@example.com",
  guardian_claim_token: "tok-1",
  parent_id: null,
  guardian_claimed_at: null,
  added_by_coach_id: "coach-1",
  invite_recipient: "guardian",
  ...over,
});

describe("listMyPendingGuardianClaims", () => {
  const base = {
    parent_profiles: [{ id: "p1", user_id: "u1" }],
    coach_profiles: [{ id: "coach-1", first_name: "Tobias", last_name: "Fairbank" }],
    coach_athletes: [{ coach_id: "coach-1", athlete_id: "ath-1" }],
  };

  it("lists unclaimed athletes a coach added with this parent's provider-verified email", async () => {
    const admin = fakeAdmin({ ...base, athletes: [athlete()] }, google("Renata@Example.com"));
    expect(await listMyPendingGuardianClaims(admin, "u1")).toEqual({
      claims: [
        {
          token: "tok-1",
          athleteFirstName: "Linnea",
          athleteLastName: "Corwin",
          coachName: "Tobias Fairbank",
        },
      ],
    });
  });

  it("skips claimed, linked, athlete-addressed and other people's athletes", async () => {
    const admin = fakeAdmin(
      {
        ...base,
        athletes: [
          athlete({ guardian_claim_token: "claimed", guardian_claimed_at: "2026-10-02" }),
          athlete({ guardian_claim_token: "linked", parent_id: "p9" }),
          athlete({ guardian_claim_token: "adult", invite_recipient: "athlete" }),
          athlete({ guardian_claim_token: "other", guardian_email: "someone@example.com" }),
        ],
      },
      google("renata@example.com"),
    );
    expect((await listMyPendingGuardianClaims(admin, "u1")).claims).toEqual([]);
  });

  it("skips a teen's own sign-up and athletes no coach has on a roster any more", async () => {
    const admin = fakeAdmin(
      {
        ...base,
        athletes: [
          athlete({ id: "teen", guardian_claim_token: "teen", user_id: "teen-user" }),
          athlete({ id: "removed", guardian_claim_token: "removed" }),
        ],
        coach_athletes: [{ coach_id: "coach-1", athlete_id: "teen" }],
      },
      google("renata@example.com"),
    );
    expect((await listMyPendingGuardianClaims(admin, "u1")).claims).toEqual([]);
  });

  it("never hands a claim to a password account: sign-ups are auto-confirmed, so that proves nothing", async () => {
    const admin = fakeAdmin(
      { ...base, athletes: [athlete()] },
      {
        email: "renata@example.com",
        email_confirmed_at: "2026-10-01T00:00:00Z",
        identities: [
          {
            provider: "email",
            identity_data: { email: "renata@example.com", email_verified: true },
          },
        ],
      },
    );
    expect((await listMyPendingGuardianClaims(admin, "u1")).claims).toEqual([]);
  });

  it("needs a parent profile and a verified email", async () => {
    const unconfirmed = fakeAdmin(
      { ...base, athletes: [athlete()] },
      { email: "renata@example.com", email_confirmed_at: null },
    );
    expect((await listMyPendingGuardianClaims(unconfirmed, "u1")).claims).toEqual([]);
    const notParent = fakeAdmin(
      { ...base, parent_profiles: [], athletes: [athlete()] },
      google("renata@example.com"),
    );
    expect((await listMyPendingGuardianClaims(notParent, "u1")).claims).toEqual([]);
  });
});

describe("providerVerifiedEmail", () => {
  it("accepts an Apple or Google identity that verified the same address", () => {
    expect(providerVerifiedEmail(google("renata@example.com"), "renata@example.com")).toBe(true);
    const apple = {
      identities: [
        {
          provider: "apple",
          identity_data: { email: "Renata@Example.com", email_verified: "true" },
        },
      ],
    };
    expect(providerVerifiedEmail(apple, "renata@example.com")).toBe(true);
  });

  it("refuses password identities, other addresses and unverified ones", () => {
    const email = {
      identities: [
        { provider: "email", identity_data: { email: "r@example.com", email_verified: true } },
      ],
    };
    expect(providerVerifiedEmail(email, "r@example.com")).toBe(false);
    expect(providerVerifiedEmail(google("other@example.com"), "r@example.com")).toBe(false);
    const unverified = {
      identities: [{ provider: "google", identity_data: { email: "r@example.com" } }],
    };
    expect(providerVerifiedEmail(unverified, "r@example.com")).toBe(false);
    expect(providerVerifiedEmail(null, "r@example.com")).toBe(false);
  });
});

describe("merging a pending claim", () => {
  it("offers no merge for a teen's own sign-up row (merging would delete their login's athlete)", async () => {
    const admin = fakeAdmin(
      {
        parent_profiles: [{ id: "p1", user_id: "u1" }],
        athletes: [
          athlete({ id: "teen", guardian_claim_token: "teen", user_id: "teen-user" }),
          athlete({ id: "mine", guardian_claim_token: null, parent_id: "p1" }),
        ],
      },
      google("renata@example.com"),
    );
    expect(await getGuardianClaimMergeOptions(admin, "u1", { token: "teen" })).toEqual({
      options: [],
    });
    const coachAdded = fakeAdmin(
      {
        parent_profiles: [{ id: "p1", user_id: "u1" }],
        athletes: [
          athlete({ id: "pending", guardian_claim_token: "tok" }),
          athlete({ id: "mine", guardian_claim_token: null, parent_id: "p1" }),
        ],
      },
      google("renata@example.com"),
    );
    expect(
      (await getGuardianClaimMergeOptions(coachAdded, "u1", { token: "tok" })).options.map(
        (o) => o.athleteId,
      ),
    ).toEqual(["mine"]);
  });
});

describe("guardian emails escape what people typed", () => {
  const name = 'Lin<a href="https://evil.test/x">verify here</a>';
  it("the invite never turns a coach-typed name into a link", async () => {
    for (const existingAccount of [true, false]) {
      const html = await render(
        React.createElement(GuardianInviteEmail, {
          athleteName: name,
          coachName: "Tobias Fairbank",
          claimUrl: "https://gradus.training/g/tok-1",
          existingAccount,
        }),
      );
      expect(html).not.toContain('href="https://evil.test');
    }
  });

  it("nor does the message copy", async () => {
    const html = await render(
      React.createElement(GuardianActivityEmail, {
        athleteName: name,
        senderName: "Tobias Fairbank",
        senderRole: "coach",
        body: "See you Thursday.",
        claimUrl: "https://gradus.training/g/tok-1",
        existingAccount: true,
      }),
    );
    expect(html).not.toContain('href="https://evil.test');
    expect(html).toContain('href="https://gradus.training/g/tok-1"');
  });
});

describe("guardian emails for an address that already has a parent account", () => {
  it("the invite asks them to sign in and confirm, never to create an account", async () => {
    const text = await render(
      React.createElement(GuardianInviteEmail, {
        athleteName: "Linnea",
        coachName: "Tobias Fairbank",
        claimUrl: "https://gradus.training/g/tok-1",
        existingAccount: true,
      }),
      { plainText: true },
    );
    expect(text).toContain("You already have a Gradus parent account with this email.");
    expect(text).toContain("Sign in to confirm");
    expect(text).not.toContain("Create your free parent account");
  });

  it("the message copy says the same", async () => {
    const text = await render(
      React.createElement(GuardianActivityEmail, {
        athleteName: "Linnea",
        senderName: "Tobias Fairbank",
        senderRole: "coach",
        body: "See you Thursday.",
        claimUrl: "https://gradus.training/g/tok-1",
        existingAccount: true,
      }),
      { plainText: true },
    );
    expect(text).toContain("Sign in to confirm");
    expect(text).toContain("These copies stop as soon as you confirm.");
    expect(text).not.toContain("Create my parent account");
  });

  it("a new guardian still gets the create-account copy", async () => {
    const text = await render(
      React.createElement(GuardianActivityEmail, {
        athleteName: "Linnea",
        senderName: "Tobias Fairbank",
        senderRole: "coach",
        body: "See you Thursday.",
        claimUrl: "https://gradus.training/g/tok-1",
      }),
      { plainText: true },
    );
    expect(text).toContain("Create my parent account");
  });
});

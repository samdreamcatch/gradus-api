// DEV-ONLY. Edit this list to add/remove seeded accounts shown in the
// DevTools account switcher. Password comes from VITE_DEV_SEED_PASSWORD
// (set in .env). Never hardcode passwords here.

export type DevRole = "coach" | "parent" | "athlete";

export type DevAccount = {
  email: string;
  label: string;
  role: DevRole;
  /** Optional context — e.g. "shares athlete with Parent A". */
  note?: string;
  /** Route to land on after sign-in (post-onboarding home). */
  home: string;
};

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    email: "coach@test.dev",
    label: "Tami Taylor",
    role: "coach",
    note: "Coach — rosters Jamie & Beverly",
    home: "/coach",
  },
  {
    email: "parent@test.dev",
    label: "Parent of Jamie Gilmore",
    role: "parent",
    note: "Linked to Tami",
    home: "/parent/plans",
  },
  {
    email: "parent2@test.dev",
    label: "Parent of Beverly Cleaver",
    role: "parent",
    note: "Linked to Tami",
    home: "/parent/plans",
  },
  {
    email: "athlete6@test.dev",
    label: "Jamie Gilmore",
    role: "athlete",
    note: "Tami's athlete",
    home: "/athlete",
  },
  {
    email: "athlete@test.dev",
    label: "Beverly Cleaver",
    role: "athlete",
    note: "Tami's athlete",
    home: "/athlete",
  },
];

export const ONBOARDING_STEPS: Record<DevRole, { label: string; to: string }[]> = {
  parent: [
    { label: "1. Parent account", to: "/signup/parent" },
    { label: "2. Add athletes", to: "/signup/parent/athletes" },
    { label: "3. Goals", to: "/signup/parent/goals" },
    { label: "4. Schedule", to: "/signup/parent/schedule" },
  ],
  coach: [
    { label: "1. Coach account", to: "/signup/coach" },
    { label: "2. Coach onboarding", to: "/coach/onboarding" },
  ],
  athlete: [
    { label: "1. Athlete invite", to: "/signup/athlete" },
    { label: "2. Account", to: "/signup/athlete/account" },
    { label: "3. Confirm", to: "/signup/athlete/confirm" },
  ],
};

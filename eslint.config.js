import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const serverOnlyRestriction = {
  name: "server-only",
  message:
    "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
};

const sportsPosterRestriction = {
  name: "@/components/ui/sports-poster",
  message:
    "SportsPoster is reserved for ceremony surfaces (auth entry, signup roots, celebration). Do not import into authenticated app pages, lists, or dashboards. See the doctrine block in src/components/ui/sports-poster.tsx.",
};

// Files allowed to import SportsPoster. Additive by design — new ceremony
// surfaces require a one-line change here.
const sportsPosterAllowlist = [
  "src/routes/login.tsx",
  "src/routes/forgot-password.tsx",
  "src/routes/reset-password.tsx",
  "src/routes/i.$code.tsx",
  "src/routes/signup.athlete.tsx",
  "src/routes/signup.athlete.adult.tsx",
  "src/routes/signup.coach.tsx",
  "src/routes/signup.parent.tsx",
  "src/components/connection-celebration.tsx",
  "src/components/onboarding/invite-card.tsx",
  "src/components/ui/sports-poster.tsx",
];

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Formatting is auto-fixable and should never break CI.
      "prettier/prettier": "warn",
      // Pre-existing `any` usage is style debt, not a build blocker.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [serverOnlyRestriction, sportsPosterRestriction],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Ceremony-surface allowlist: SportsPoster import permitted here.
    files: sportsPosterAllowlist,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [serverOnlyRestriction],
        },
      ],
    },
  },
  eslintPluginPrettier,
);

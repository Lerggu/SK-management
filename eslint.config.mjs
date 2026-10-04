import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      // Layer guard (also enforced by dependency-cruiser).
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@prisma/client", message: "app/ must not import Prisma; use module services." }], patterns: ["@/platform/db", "@/platform/db/*"] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "src/ui/components/**"]),
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    ".agents/**",
    ".tenki/**",
    "coverage/**",
    "next-env.d.ts",
    "workers/status-page/**",
    "workers/**/worker-configuration.d.ts",
  ]),
]);

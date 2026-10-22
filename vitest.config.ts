import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Playwright owns e2e/; Vitest would otherwise collect its *.spec.ts files.
  test: { environment: "node", exclude: [...configDefaults.exclude, "e2e/**"] },
});

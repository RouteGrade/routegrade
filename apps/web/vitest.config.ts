import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Node stays the default: most of the suite is pure derivation logic that
    // shouldn't pay for a DOM. Component tests opt in per file with a
    // `// @vitest-environment jsdom` docblock, so the fast path stays fast.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

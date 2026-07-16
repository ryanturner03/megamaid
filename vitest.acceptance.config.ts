// vitest.acceptance.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/acceptance/**/*.test.ts"],
    testTimeout: 120_000, // 2 minutes — these hit live sites + Claude CLI
  },
});

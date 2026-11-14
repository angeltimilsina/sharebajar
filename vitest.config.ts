import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      "@bajar/chain-adapters": path.resolve(process.cwd(), "packages/chain-adapters/src/index.ts"),
      // `server-only` throws outside the React server runtime; stub it for unit tests.
      "server-only": path.resolve(process.cwd(), "tests/stubs/server-only.ts"),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts", "packages/*/test/**/*.test.ts", "services/*/test/**/*.test.ts"], environment: "node" },
});

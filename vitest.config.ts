import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/helpers/server-only.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});

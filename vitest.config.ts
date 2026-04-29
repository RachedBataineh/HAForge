import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/api/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@HAForge/db": path.resolve(__dirname, "packages/db/src"),
      "@HAForge/auth": path.resolve(__dirname, "packages/auth/src"),
      "@HAForge/env": path.resolve(__dirname, "packages/env/src"),
      "@HAForge/config": path.resolve(__dirname, "packages/config"),
    },
  },
});

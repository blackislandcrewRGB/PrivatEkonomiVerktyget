import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "server", include: ["server/test/**/*.test.ts"], environment: "node" } },
      {
        test: {
          name: "web",
          include: ["web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["web/test/setup.ts"],
        },
      },
    ],
  },
});

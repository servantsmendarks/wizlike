// npm run balance: バランスのシミュレーション（tests/balance/*.sim.ts）だけを回す。既定の npm test（vite.config.ts）の include には入らない。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/balance/**/*.sim.ts"],
    environment: "node",
    testTimeout: 600_000,
  },
});

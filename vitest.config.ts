import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest runs alongside Vite but with its own config so we don't pull in
// Tauri-only plugins during tests. Only pure-function modules are tested
// here — anything that imports @tauri-apps/* at top level needs vi.mock
// (see src/lib/__tests__/ examples).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    reporters: "default",
  },
});

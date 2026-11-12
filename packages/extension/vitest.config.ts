import { defineConfig } from "vitest/config";
export default defineConfig({ test: { setupFiles: ["../core/vitest.setup.ts"], testTimeout: 30000 } });

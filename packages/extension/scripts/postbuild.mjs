import { execSync } from "node:child_process";
for (const t of ["content", "provider"]) execSync("npx vite build", { stdio: "inherit", env: { ...process.env, TARGET: t } });

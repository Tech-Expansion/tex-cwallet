// Render the PNG icons (16/32/48/128) from assets/logo.svg (assets/logo-16.svg for 16 px) with Chromium.
// Usage: CHROME_PATH=<Chrome/Chromium/Edge> node scripts/icons.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const svg = (name) => readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
const exe = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
for (const s of [16, 32, 48, 128]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg(s === 16 ? "logo-16.svg" : "logo.svg").replace("<svg ", `<svg width="${s}" height="${s}" `)}</body>`);
  await p.screenshot({ path: fileURLToPath(new URL(`../public/icons/icon-${s}.png`, import.meta.url)), omitBackground: true });
}
await b.close();

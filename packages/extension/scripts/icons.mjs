// Sinh icon PNG (16/32/48/128) từ assets/logo.svg bằng Chromium.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../assets/logo.svg", import.meta.url), "utf8");
const exe = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
for (const s of [16, 32, 48, 128]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body>`);
  await p.screenshot({ path: new URL(`../public/icons/icon-${s}.png`, import.meta.url).pathname, omitBackground: true });
}
await b.close();

// Chrome Web Store images from the real built extension (AI-53): 1280x800 screenshots and the 440x280 promo tile.
// Usage: npm run build && CHROME_PATH=<Chrome for Testing or Chromium> node scripts/store-assets.mjs [outDir]
// Branded Google Chrome no longer loads unpacked extensions from the command line; use Chrome for Testing.
import { chromium } from "playwright-core";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ext = resolve(here, "../dist");
const out = resolve(process.argv[2] ?? resolve(here, "../../../docs/store"));
mkdirSync(out, { recursive: true });
const PW = "store-assets-password";

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), "s-")), {
  headless: false,
  executablePath: process.env.CHROME_PATH,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new", "--no-sandbox"],
  deviceScaleFactor: 2,
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const id = new URL(sw.url()).host;
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  // The UI defaults to English; this test drives the Vietnamese labels.
  await popup.evaluate(() => localStorage.setItem("prefs", JSON.stringify({ lang: "vi", theme: "system" })));
  await popup.reload();
  const rpc = (req) => popup.evaluate(async (r) => {
    const res = await chrome.runtime.sendMessage({ kind: "wallet", req: r });
    if (!res?.ok) throw new Error(res?.error ?? "rpc failed");
    return res.data;
  }, req);

  // Create a wallet through the UI, then switch the UI to English
  await popup.getByRole("button", { name: "Tạo ví mới" }).click();
  await popup.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await popup.getByLabel("Nhập lại mật khẩu").fill(PW);
  await popup.locator(".word").first().waitFor();
  await popup.getByRole("checkbox").check({ force: true });
  await popup.getByRole("button", { name: "Tạo ví", exact: true }).click();
  await popup.getByTestId("balance").waitFor();
  await popup.getByRole("button", { name: "Tab Cài đặt" }).click();
  await popup.getByRole("tab", { name: "English" }).click();
  await popup.getByRole("button", { name: "Lock wallet" }).waitFor();

  // A 2-of-3 multisig wallet with sample cosigners (public key hashes only)
  await rpc({ type: "sharedCreate", name: "Team treasury", required: 2, myName: "You", cosigners: [{ name: "Alice", keyHash: "ab".repeat(28) }, { name: "Bob", keyHash: "cd".repeat(28) }] });

  const shots = [];
  const take = async (title, sub) => {
    await popup.waitForTimeout(700);
    shots.push({ title, sub, png: (await popup.screenshot()).toString("base64") });
  };
  await popup.getByRole("button", { name: "Tab Wallet" }).click();
  await take("An open-source Cardano wallet", "ADA and native tokens, staking and NFTs. Your keys stay in your browser.");
  await popup.getByRole("button", { name: "Tab Multisig" }).click();
  await popup.getByTestId("ms-item").first().click();
  await popup.getByTestId("ms-address").waitFor();
  await popup.waitForFunction(() => !document.querySelector("[data-testid=ms-balance]")?.textContent?.includes("…"), null, { timeout: 15000 }).catch(() => {});
  await take("Free m-of-n multisig", "CIP-1854 shared wallets, compatible with Eternl. Propose, co-sign and submit.");
  await popup.getByRole("button", { name: "Tab Wallet" }).click();
  await popup.getByRole("button", { name: "Receive" }).click();
  await popup.locator("img[alt=QR]").waitFor();
  await take("Receive with a QR code", "Base addresses with your stake key, on the network you choose.");
  await popup.getByRole("button", { name: "Back" }).click();
  await popup.getByRole("button", { name: "Tab Settings" }).click();
  await take("Simple and transparent", "Open source under Apache-2.0. Vietnamese and English, light and dark themes.");

  const logo = readFileSync(resolve(here, "../assets/logo.svg"), "utf8").replace(/<!--.*?-->/s, "");
  // CKBolt-style composition: paper ground with faint vertical grid, ink type, mono eyebrow, hairline frame, no shadows.
  const page = await ctx.newPage();
  const fontFile = (pkg, file) => readFileSync(resolve(dirname(require.resolve(`${pkg}/package.json`)), "files", file)).toString("base64");
  const fonts = `<style>
    @font-face{font-family:"Instrument Sans";font-weight:400;src:url(data:font/woff2;base64,${fontFile("@fontsource/instrument-sans", "instrument-sans-latin-400-normal.woff2")}) format("woff2")}
    @font-face{font-family:"Instrument Sans";font-weight:500;src:url(data:font/woff2;base64,${fontFile("@fontsource/instrument-sans", "instrument-sans-latin-500-normal.woff2")}) format("woff2")}
    @font-face{font-family:"JetBrains Mono";font-weight:400;src:url(data:font/woff2;base64,${fontFile("@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2")}) format("woff2")}
    body{margin:0;background:#FAFAF9;color:#080503;font-family:"Instrument Sans",sans-serif;
      background-image:linear-gradient(to right,rgba(8,5,3,.05) 1px,transparent 1px);background-size:200px 100%}
    .mono{font-family:"JetBrains Mono",monospace;font-size:14px;color:#5E534A;display:flex;align-items:center;gap:12px}
    .rule{width:32px;height:1px;background:#5E534A}
    .pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(8,5,3,.2);border-radius:9999px;padding:6px 14px;font-size:14px}
    .dot{width:6px;height:6px;border-radius:9999px;background:#00BA87}
  </style>`;
  const brand = (px) => `<div style="display:flex;align-items:center;gap:${px * 0.3}px">${logo.replace("<svg ", `<svg width="${px}" height="${px}" `)}<span style="font-size:${px * 0.62}px;letter-spacing:-.025em">TEX Wallet</span></div>`;
  for (const [i, s] of shots.entries()) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`<html><head>${fonts}</head><body style="width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:96px">
      <div style="width:540px;height:640px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:space-between">${brand(40)}<span class="pill"><span class="dot"></span>Preprod testnet</span></div>
        <div style="margin-top:auto" class="mono"><span class="rule"></span>${String(i + 1).padStart(2, "0")} / ${String(shots.length).padStart(2, "0")}</div>
        <div style="font-size:60px;line-height:1;letter-spacing:-.025em;margin-top:24px">${s.title}</div>
        <div style="font-size:22px;line-height:1.6;color:#5E534A;margin-top:24px">${s.sub}</div>
        <div class="mono" style="margin-top:auto;font-size:13px">Open source · Apache-2.0 · Not audited</div>
      </div>
      <img src="data:image/png;base64,${s.png}" style="width:384px;height:640px;border:1px solid rgba(8,5,3,.12)"></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, `screenshot-${i + 1}.png`), scale: "css" });
  }
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<html><head>${fonts}</head><body style="width:440px;height:280px;background-size:88px 100%;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box">
    ${brand(48)}
    <div class="mono" style="margin-top:22px;font-size:13px"><span class="rule" style="width:24px"></span>Cardano · CIP-30 · m-of-n multisig</div>
    <div style="font-size:17px;color:#5E534A;margin-top:10px">Open-source Cardano wallet with multisig</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, "promo-small-440x280.png"), scale: "css" });
  console.log(`store assets written to ${out}`);
} finally {
  await ctx.close();
}

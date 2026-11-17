// Chrome Web Store images from the real built extension (AI-53): 1280x800 screenshots and the 440x280 promo tile.
// Usage: npm run build && CHROME_PATH=<Chrome for Testing or Chromium> node scripts/store-assets.mjs [outDir]
// Branded Google Chrome no longer loads unpacked extensions from the command line; use Chrome for Testing.
import { chromium } from "playwright-core";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
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
  await take("Free m-of-n multisig", "CIP-1854 shared wallets, compatible with Eternl. Propose, co-sign and submit.");
  await popup.getByRole("button", { name: "Tab Wallet" }).click();
  await popup.getByRole("button", { name: "Receive" }).click();
  await popup.locator("img[alt=QR]").waitFor();
  await take("Receive with a QR code", "Base addresses with your stake key, on the network you choose.");
  await popup.getByRole("button", { name: "Back" }).click();
  await popup.getByRole("button", { name: "Tab Settings" }).click();
  await take("Simple and transparent", "Open source under Apache-2.0. Vietnamese and English, light and dark themes.");

  const icon = readFileSync(resolve(ext, "icons/icon-128.png")).toString("base64");
  const page = await ctx.newPage();
  const bg = "radial-gradient(circle at 20% 20%, #1e3a8a 0%, #0b1020 55%), #0b1020";
  for (const [i, s] of shots.entries()) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`<html><body style="margin:0;width:1280px;height:800px;background:${bg};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;gap:90px;color:#e6e9f2">
      <div style="width:520px"><div style="display:flex;align-items:center;gap:14px;margin-bottom:28px"><img src="data:image/png;base64,${icon}" width="56" height="56"><span style="font-size:28px;font-weight:700">TEX Wallet</span></div>
      <div style="font-size:46px;font-weight:700;line-height:1.15">${s.title}</div><div style="font-size:22px;line-height:1.5;color:#b8c0de;margin-top:20px">${s.sub}</div></div>
      <img src="data:image/png;base64,${s.png}" style="width:384px;height:640px;border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.55);border:1px solid #2a3560"></body></html>`);
    await page.screenshot({ path: resolve(out, `screenshot-${i + 1}.png`), scale: "css" });
  }
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<html><body style="margin:0;width:440px;height:280px;background:${bg};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e6e9f2">
    <img src="data:image/png;base64,${icon}" width="72" height="72"><div style="font-size:34px;font-weight:700;margin-top:12px">TEX Wallet</div>
    <div style="font-size:16px;color:#b8c0de;margin-top:6px">Open-source Cardano wallet with multisig</div></body></html>`);
  await page.screenshot({ path: resolve(out, "promo-small-440x280.png"), scale: "css" });
  console.log(`store assets written to ${out}`);
} finally {
  await ctx.close();
}

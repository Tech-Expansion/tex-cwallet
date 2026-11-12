// E2E bản web. Mặc định: serve dist-web + proxy thật (upstream giả). Với BASE_URL: chạy smoke test trên bản đã deploy.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist-web");
const PW = "e2e-password-1";
const log = (m) => console.log("•", m);
const LIVE = process.env.BASE_URL;
let base = LIVE, closers = [], proxy;

if (!LIVE) {
  const { createProxy } = await import("../../proxy/src/proxy.ts");
  const upstream = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (/\/addresses\/[^/]+$/.test(req.url)) return res.end(JSON.stringify({ amount: [{ unit: "lovelace", quantity: "12000000" }] }));
    if (/\/transactions/.test(req.url)) return res.end("[]");
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  proxy = createProxy({ keys: { preprod: "K" }, upstream: { preprod: `http://127.0.0.1:${upstream.address().port}/api/v0` } });
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  const web = createServer((req, res) => {
    if (req.url.startsWith("/proxy/")) { req.url = req.url.slice(6); return void proxy.handle(req, res); }
    let f = resolve(root, "." + (req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]));
    if (!f.startsWith(root) || !existsSync(f)) f = resolve(root, "index.html");
    res.setHeader("content-type", types[extname(f)] ?? "application/octet-stream");
    res.end(readFileSync(f));
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${web.address().port}/`;
  closers = [() => web.close(), () => upstream.close()];
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);

  await page.getByRole("button", { name: "Tạo ví mới" }).click();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await page.getByLabel("Nhập lại mật khẩu").fill(PW);
  await page.locator(".word").first().waitFor();
  assert.equal(await page.locator(".word").count(), 24);
  await page.getByRole("checkbox").check({ force: true });
  await page.getByRole("button", { name: "Tạo ví", exact: true }).click();
  await page.getByTestId("balance").waitFor();
  // Trên testnet bản web phải tải được số dư/lịch sử (trước đây Koios bị chặn CORS): không được có lỗi
  await page.waitForFunction(() => /^\d/.test(document.querySelector("[data-testid=balance]")?.textContent ?? ""), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.getByRole("alert").count(), 0, "dashboard testnet không được báo lỗi (CORS)");
  log("tạo ví (web) OK, tải số dư testnet qua proxy OK");

  await page.getByRole("button", { name: "Nhận" }).click();
  assert.match(await page.getByTestId("addr").innerText(), /^addr_test1/);
  await page.getByRole("button", { name: "Quay lại" }).click();

  // Multisig (CIP-1854/0146) cũng chạy trên bản web
  await page.getByRole("button", { name: "Tab Multisig" }).click();
  await page.waitForFunction(() => /^[0-9a-f]{56}$/.test(document.querySelector("[data-testid=ms-keyhash]")?.textContent ?? ""), null, { timeout: 15000 });
  await page.getByTestId("ms-new").click();
  await page.getByLabel("Tên ví").fill("Quỹ web");
  await page.getByLabel("Tên 1", { exact: true }).fill("Bình");
  await page.getByLabel("Key cosigner 1").fill("ab".repeat(28));
  await page.getByLabel("Số chữ ký tối thiểu").fill("2");
  await page.getByTestId("ms-preview-address").waitFor();
  await page.getByTestId("ms-create-submit").click();
  await page.getByTestId("ms-address").waitFor();
  assert.match(await page.getByTestId("ms-address").innerText(), /^addr_test1w/);
  log("multisig trên web OK");
  await page.getByRole("button", { name: "Tab Ví" }).click();

  // Preprod only: no other network to choose
  await page.getByRole("button", { name: "Tab Cài đặt" }).click();
  assert.equal(await page.getByTestId("network-fixed").innerText(), "Preprod");
  assert.equal(await page.getByRole("tab", { name: "Mainnet" }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Preview" }).count(), 0);
  await page.getByRole("button", { name: "Tab Ví" }).click();
  await page.getByRole("button", { name: "Nhận" }).click();
  assert.match(await page.getByTestId("addr").innerText(), /^addr_test1/);
  await page.getByRole("button", { name: "Quay lại" }).click();
  log("chỉ preprod OK");

  // Tải lại: ví tự khóa, dữ liệu còn
  await page.reload();
  await page.getByRole("heading", { name: "Mở khóa ví" }).waitFor();
  await page.getByLabel("Mật khẩu").fill(PW);
  await page.getByRole("button", { name: "Mở khóa" }).click();
  await page.getByRole("button", { name: "Tab Ví" }).click();
  await page.getByTestId("balance").waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("abandon")), false);
  // mnemonic không nằm ở dạng rõ trong localStorage
  const raw = await page.evaluate(() => localStorage.getItem("w:wallet-state-v1") ?? "");
  assert.ok(raw.includes('"vault"') && !/"words"/.test(raw));
  log("khóa khi tải lại + dữ liệu mã hóa OK");
  assert.equal(errors.length, 0, "lỗi JS: " + errors.join("; "));
  if (proxy) log(`proxy: upstream=${proxy.stats.upstream.preprod ?? 0} client=${proxy.stats.clientRequests}`);
  console.log("WEB E2E PASS");
} finally {
  await browser.close();
  closers.forEach((c) => c());
}

// E2E thật: nạp extension đã build vào Chromium, chạy luồng tạo ví → nhận → đổi mạng → khóa/mở khóa → dApp CIP-30.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const { createProxy } = await import("../../proxy/src/proxy.ts");

const ext = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const PW = "e2e-password-1";
const log = (m) => console.log("•", m);

const srv = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<html><body>dapp</body></html>"); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const dappUrl = `http://127.0.0.1:${srv.address().port}/`;

// Fake Blockfrost preprod upstream + the real proxy (packages/proxy) to test the Blockfrost path end to end.
const upstream = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (/\/addresses\/[^/]+$/.test(req.url)) return res.end(JSON.stringify({ amount: [{ unit: "lovelace", quantity: "12000000" }] }));
  if (/\/addresses\/[^/]+\/transactions/.test(req.url)) return res.end("[]");
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const proxy = createProxy({ keys: { preprod: "TEST_KEY" }, upstream: { preprod: `http://127.0.0.1:${upstream.address().port}/api/v0` }, adminToken: "adm" });
const proxySrv = createServer((req, res) => void proxy.handle(req, res));
await new Promise((r) => proxySrv.listen(0, "127.0.0.1", r));
const proxyUrl = `http://127.0.0.1:${proxySrv.address().port}`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), "w-")), {
  headless: false,
  executablePath: process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new", "--no-sandbox"],
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const id = new URL(sw.url()).host;
  log("service worker chạy: " + id);

  const popup = await ctx.newPage();
  const errors = [];
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);

  const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("button", { name: "Tạo ví mới" }).waitFor();
  await shot(popup, "01-welcome");

  // Tạo ví: đặt mật khẩu + sao lưu 24 từ
  await popup.getByRole("button", { name: "Tạo ví mới" }).click();
  await popup.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await popup.getByLabel("Nhập lại mật khẩu").fill(PW);
  await popup.locator(".word").first().waitFor();
  assert.equal(await popup.locator(".word").count(), 24);
  const save = popup.getByRole("button", { name: "Tạo ví", exact: true });
  assert.equal(await save.isDisabled(), true, "phải xác nhận sao lưu trước khi lưu");
  await shot(popup, "02-create");
  await popup.getByRole("checkbox").check({ force: true });
  await save.click();
  await popup.getByTestId("balance").waitFor();
  await popup.waitForTimeout(600);
  await shot(popup, "03-dashboard");
  log("tạo ví xong, vào trang chính");

  // Địa chỉ nhận
  await popup.getByRole("button", { name: "Nhận" }).click();
  const addr = await popup.getByTestId("addr").innerText();
  assert.match(addr, /^addr_test1/);
  await popup.locator("img[alt=QR]").waitFor();
  await shot(popup, "04-receive");
  await popup.getByRole("button", { name: "Quay lại" }).click();

  // Validate gửi
  await popup.getByRole("button", { name: "Gửi", exact: true }).click();
  await popup.getByLabel("Địa chỉ nhận").fill("addr1bad");
  await popup.getByLabel("Số ADA").fill("5");
  await popup.getByRole("button", { name: "Xem lại" }).click();
  await popup.getByRole("alert").waitFor();
  assert.match(await popup.getByRole("alert").innerText(), /addr_test1/);
  await shot(popup, "05-send");
  // valid address but empty wallet -> no transaction is built, the sign sheet does not open (AI-5 AC-003)
  await popup.getByLabel("Địa chỉ nhận").fill(addr);
  await popup.getByRole("button", { name: "Xem lại" }).click();
  await popup.getByRole("alert").filter({ hasText: /Không đủ ADA/ }).waitFor({ timeout: 20000 });
  assert.equal(await popup.getByRole("dialog").count(), 0, "không được mở bảng ký khi không đủ tiền");
  await shot(popup, "06-send-insufficient");
  await popup.getByRole("button", { name: "Quay lại" }).click();
  log("validate form gửi (địa chỉ sai, không đủ tiền) OK");

  // Multisig kiểu Eternl (CIP-1854/0146), dùng dữ liệu THẬT trên preprod qua Koios
  await popup.getByRole("button", { name: "Tab Multisig" }).click();
  await popup.waitForFunction(() => /^[0-9a-f]{56}$/.test(document.querySelector("[data-testid=ms-keyhash]")?.textContent ?? ""), null, { timeout: 15000 });
  await popup.getByTestId("ms-discover").click();
  await popup.getByTestId("toast").filter({ hasText: /Không tìm thấy|Tìm thấy/ }).waitFor({ timeout: 60000 }); // khám phá thật qua Koios
  log("khám phá multisig (Koios thật) OK");
  // nhập một đăng ký multisig thật đã có trên preprod (tạo bởi ví Eternl/Mesh khác)
  const list = await (await fetch("https://preprod.koios.rest/api/v1/tx_by_metalabel?_label=1854&limit=30&order=block_height.asc")).json();
  const cbors = await (await fetch("https://preprod.koios.rest/api/v1/tx_cbor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: list.map((t) => t.tx_hash) }) })).json();
  const imported = await popup.evaluate(async (cs) => {
    for (const c of cs) {
      const r = await chrome.runtime.sendMessage({ kind: "wallet", req: { type: "sharedImport", input: c.cbor } });
      if (r?.ok) return r.data;
    }
    return null;
  }, cbors);
  assert.ok(imported?.address?.startsWith("addr_test1"), "phải nhập được ít nhất một đăng ký thật");
  await popup.getByRole("button", { name: "Tab Ví" }).click();
  await popup.getByRole("button", { name: "Tab Multisig" }).click();
  await popup.getByTestId("ms-item").first().click();
  assert.equal(await popup.getByTestId("ms-address").innerText(), imported.address);
  await popup.getByText("Khóa của bạn không nằm trong ví này").waitFor(); // không phải cosigner → không cho ký
  await shot(popup, "11-multisig-real");
  log(`nhập đăng ký thật OK (${imported.name}, ${imported.required}/${imported.signers.length})`);
  await popup.getByRole("button", { name: "Quay lại" }).click();

  // Tạo ví multisig mới 2/3 qua giao diện
  await popup.getByTestId("ms-new").click();
  await popup.getByLabel("Tên ví").fill("Quỹ E2E");
  await popup.getByLabel("Cosigner khác").fill(`Bình ${"ab".repeat(28)}\nChi ${"cd".repeat(28)}`);
  await popup.getByTestId("ms-create-submit").click();
  await popup.getByTestId("ms-address").waitFor();
  await popup.getByText("2 trong 3 chữ ký").first().waitFor();
  const msAddr = await popup.getByTestId("ms-address").innerText();
  assert.match(msAddr, /^addr_test1w/);
  // đề xuất khi ví chưa có tiền → bảng ký yêu cầu mật khẩu rồi báo không đủ số dư (không crash)
  await popup.getByLabel("Địa chỉ nhận").fill(addr);
  await popup.getByLabel("Số ADA", { exact: true }).fill("2");
  await popup.getByTestId("ms-propose").click();
  await popup.getByRole("dialog").waitFor();
  await popup.getByLabel("Mật khẩu ví").fill(PW);
  await popup.getByRole("button", { name: "Ký & gửi" }).click();
  await popup.getByRole("dialog").getByRole("alert").filter({ hasText: /số dư/i }).waitFor({ timeout: 60000 });
  await shot(popup, "12-multisig-create");
  log("tạo ví multisig + đề xuất (chưa có tiền) OK");
  await popup.getByRole("button", { name: "Hủy" }).click();
  await popup.getByRole("button", { name: "Tab Ví" }).click();

  // Hoạt động, Cài đặt, đổi mạng, giao diện sáng
  await popup.getByRole("button", { name: "Tab Hoạt động" }).click();
  await popup.getByText("Chưa có giao dịch").waitFor();
  await popup.getByRole("button", { name: "Tab Cài đặt" }).click();
  assert.equal(await popup.getByTestId("network-fixed").innerText(), "Preprod");
  assert.equal(await popup.getByRole("tab", { name: "Preview" }).count(), 0, "không có mạng nào khác preprod");
  assert.equal(await popup.getByRole("tab", { name: "Mainnet" }).count(), 0, "không có mạng nào khác preprod");
  await popup.getByRole("tab", { name: "Sáng" }).click();
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.theme), "light");
  await shot(popup, "07-settings-light");
  await popup.getByRole("button", { name: "Tab Ví" }).click();
  await popup.waitForTimeout(500);
  await shot(popup, "08-dashboard-light");
  await popup.getByRole("button", { name: "Tab Cài đặt" }).click();
  await popup.getByRole("tab", { name: "English" }).click();
  await popup.getByRole("button", { name: "Lock wallet" }).waitFor();
  await popup.getByRole("tab", { name: "Tiếng Việt" }).click();
  await popup.getByRole("tab", { name: "Tối" }).click();
  log("điều hướng, đổi mạng/giao diện/ngôn ngữ OK");

  // Blockfrost preprod through the real proxy (optional instead of Koios)
  await popup.getByRole("button", { name: "Tab Cài đặt" }).click();
  await popup.getByLabel("Proxy dữ liệu (Blockfrost)").fill(proxyUrl);
  await popup.getByText("Dùng Blockfrost qua proxy thay cho Koios").click();
  await popup.getByRole("button", { name: "Lưu proxy" }).click();
  await popup.getByRole("button", { name: "Tab Ví" }).click();
  await popup.getByRole("button", { name: "Làm mới" }).click();
  await popup.waitForFunction(() => document.querySelector("[data-testid=balance]")?.textContent === "12", null, { timeout: 15000 });
  assert.equal(proxy.stats.upstream.preprod >= 1, true);
  await shot(popup, "10-blockfrost-preprod");
  log(`Blockfrost preprod qua proxy OK (upstream=${proxy.stats.upstream.preprod}, client=${proxy.stats.clientRequests})`);
  await popup.getByRole("button", { name: "Tab Cài đặt" }).click();
  await popup.getByLabel("Proxy dữ liệu (Blockfrost)").fill("");
  await popup.getByText("Dùng Blockfrost qua proxy thay cho Koios").click();
  await popup.getByRole("button", { name: "Lưu proxy" }).click();

  // Khóa & mở khóa sai/đúng
  await popup.getByRole("button", { name: "Khóa ví" }).click();
  await popup.getByRole("heading", { name: "Mở khóa ví" }).waitFor();
  await popup.getByLabel("Mật khẩu").fill("sai-mat-khau");
  await popup.getByRole("button", { name: "Mở khóa" }).click();
  await popup.getByRole("alert").waitFor();
  await popup.getByLabel("Mật khẩu").fill(PW);
  await popup.getByRole("button", { name: "Mở khóa" }).click();
  await popup.getByRole("button", { name: "Tab Ví" }).click();
  await popup.getByTestId("balance").waitFor();
  log("khóa/mở khóa OK");

  // dApp CIP-30
  const dapp = await ctx.newPage();
  await dapp.goto(dappUrl);
  assert.equal(await dapp.evaluate(() => typeof window.cardano?.walletcardano?.enable), "function");
  assert.equal(await dapp.evaluate(() => window.cardano.walletcardano.isEnabled()), false);
  const approvalP = ctx.waitForEvent("page", { timeout: 20000 });
  const enableP = dapp.evaluate(() => window.cardano.walletcardano.enable().then((api) => (window.__api = api, "enabled"), (e) => "rejected:" + JSON.stringify(e)));
  const approval = await approvalP;
  await approval.waitForLoadState();
  await approval.getByTestId("origin").waitFor();
  await shot(approval, "09-approve");
  await approval.getByRole("button", { name: "Chấp nhận" }).click();
  assert.equal(await enableP, "enabled");
  const netId = await dapp.evaluate(() => window.__api.getNetworkId());
  log("dApp enable OK, networkId = " + netId);
  assert.equal(netId, 0);
  // Đúng như Mesh Multisig đăng nhập: ký nonce hex bằng địa chỉ reward, chữ ký phải là COSE_Sign1 hợp lệ
  const rewardHex = await dapp.evaluate(async () => (await window.__api.getRewardAddresses())[0]);
  const signP = dapp.evaluate(async (r) => { try { return await window.__api.signData(r, "5fd9786a30ce6821757bf5203ac2af33"); } catch (e) { return { err: JSON.stringify(e) }; } }, rewardHex);
  const ap2 = await ctx.waitForEvent("page", { timeout: 20000 });
  await ap2.getByTestId("origin").waitFor();
  assert.match(await ap2.getByTestId("detail").innerText(), /5fd9786a30ce6821757bf5203ac2af33/);
  await ap2.getByRole("button", { name: "Chấp nhận" }).click();
  const sig = await signP;
  assert.ok(sig.signature && sig.key, "signData phải trả {signature, key}: " + JSON.stringify(sig));
  assert.equal(errors.length, 0, "popup không được có lỗi JS: " + errors.join("; "));
  console.log("E2E PASS");
} finally {
  await ctx.close();
  srv.close();
  proxySrv.close();
  upstream.close();
}

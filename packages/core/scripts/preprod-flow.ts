/**
 * Luồng thử multisig 2-of-2 THẬT trên Preprod (Koios công khai), dùng hai ví thử nghiệm dùng một lần.
 *   setup  : tạo ví A và B, lập ví multisig 2-of-2, in địa chỉ cần nạp tADA
 *   run    : đợi tiền về → (tùy chọn) đăng ký on-chain → A đề xuất → B kiểm tra, ký, gửi → đợi xác nhận
 *   status : xem số dư và trạng thái
 * Dữ liệu ví nằm ở .flow-preprod/ (git bỏ qua, quyền 600). CHỈ dùng cho testnet.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WalletManager, type KeyValueStore } from "../src/index";

const DIR = resolve(process.env.FLOW_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../../../.flow-preprod"));
const PW = "preprod-flow-pass"; // chỉ dùng cho ví thử nghiệm trên testnet
const FUND_MIN = 12_000_000n; // lovelace cần có ở địa chỉ multisig
const SEND = 5_000_000n;
mkdirSync(DIR, { recursive: true, mode: 0o700 });

class FileStore implements KeyValueStore {
  constructor(private file: string) {}
  private read(): Record<string, unknown> { return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {}; }
  async get<T>(k: string) { return this.read()[k] as T | undefined; }
  async set<T>(k: string, v: T) { const d = this.read(); d[k] = v; writeFileSync(this.file, JSON.stringify(d), { mode: 0o600 }); chmodSync(this.file, 0o600); }
  async remove(k: string) { const d = this.read(); delete d[k]; writeFileSync(this.file, JSON.stringify(d), { mode: 0o600 }); }
}

async function user(name: string, create: boolean) {
  const m = new WalletManager(new FileStore(join(DIR, `${name}.json`)));
  await m.load();
  if (!m.hasVault()) {
    if (!create) throw new Error(`Chưa có ví ${name}: chạy "setup" trước`);
    await m.setupPassword(PW);
    await m.addWallet(name, m.newMnemonic());
  } else await m.unlock(PW);
  await m.setNetwork("preprod");
  return m;
}

const ada = (l: string | bigint) => (Number(l) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const lov = async (m: WalletManager) => BigInt((await m.getBalance()).find((b) => b.unit === "lovelace")?.quantity ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const infoFile = join(DIR, "info.json");
const info = () => JSON.parse(readFileSync(infoFile, "utf8")) as { id: string; address: string; a: string; b: string; reg?: string };

async function setup() {
  const A = await user("A", true), B = await user("B", true);
  let i: ReturnType<typeof info> | undefined = existsSync(infoFile) ? info() : undefined;
  if (!i) {
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    const w = await A.createShared({ name: "Flow 2-of-2", required: 2, cosigners: [{ name: "B", keyHash: kb }], myName: "A" });
    await B.importShared(A.exportShared(w.id));
    i = { id: w.id, address: w.address, a: (await A.getAccount()).baseAddress, b: (await B.getAccount()).baseAddress };
    writeFileSync(infoFile, JSON.stringify(i, null, 2), { mode: 0o600 });
  }
  console.log(`
Đã sẵn sàng. Hãy xin tADA từ faucet (https://docs.cardano.org/cardano-testnets/tools/faucet, chọn PREPROD):

  1) Địa chỉ MULTISIG 2-of-2 (bắt buộc, nạp >= ${ada(FUND_MIN)} tADA):
     ${i.address}

  2) Địa chỉ ví A (tùy chọn, >= 3 tADA, để đăng ký ví on-chain cho B tự khám phá):
     ${i.a}

Sau khi nạp xong chạy:  run
`);
}

async function status() {
  const i = info();
  const A = await user("A", false), B = await user("B", false);
  console.log("multisig :", ada(BigInt((await A.sharedBalance(i.id)).find((b) => b.unit === "lovelace")?.quantity ?? 0)), "tADA", i.address);
  console.log("ví A     :", ada(await lov(A)), "tADA");
  console.log("ví B     :", ada(await lov(B)), "tADA");
}

async function run() {
  const i = info();
  const A = await user("A", false), B = await user("B", false);
  const multi = async () => BigInt((await A.sharedBalance(i.id)).find((b) => b.unit === "lovelace")?.quantity ?? 0);
  console.log("Đang đợi tADA về địa chỉ multisig…", i.address);
  const deadline = Date.now() + 40 * 60_000;
  let fundedBy = 0n;
  while ((fundedBy = await multi().catch(() => 0n)) < FUND_MIN) {
    if (Date.now() > deadline) throw new Error("Hết thời gian chờ tiền (40 phút)");
    await sleep(15_000);
  }
  console.log(`✓ Multisig có ${ada(fundedBy)} tADA`);

  // Đăng ký on-chain nếu ví A có tiền (để B khám phá tự động thay vì nhập tay)
  if (!i.reg && (await lov(A)) >= 3_000_000n) {
    console.log("Ví A có tiền → đăng ký ví on-chain (CIP-0146)…");
    i.reg = await A.registerShared(i.id);
    writeFileSync(infoFile, JSON.stringify(i, null, 2), { mode: 0o600 });
    console.log("✓ Đã đăng ký:", i.reg);
  }

  const before = await lov(B);
  console.log(`A đề xuất chi ${ada(SEND)} tADA tới ví B…`);
  const request = await A.proposeShared(i.id, i.b, SEND, "Luồng thử 2-of-2");
  const mid = (await A.listRequests(i.id))[0]!;
  console.log(`✓ Đề xuất đã tạo, chữ ký ${mid.preview.signedBy.length}/2, phí ${ada(mid.preview.fee)} tADA`);
  try { await A.submitRequest(request); throw new Error("BUG: gửi được khi mới 1/2 chữ ký"); } catch (e) { if (!/chữ ký/.test(String(e))) throw e; console.log("✓ Gửi sớm bị chặn:", (e as Error).message); }

  const insp = await B.inspectRequest(request);
  console.log(`B kiểm tra yêu cầu (CIP-1854): ${insp.preview.outputs.map((o) => `${ada(o.lovelace)} → ${o.change ? "(tiền thừa)" : o.address.slice(0, 20) + "…"}`).join("; ")}`);
  const signed = await B.signRequest(request, PW);
  console.log(`✓ B đã ký, chữ ký ${signed.preview.signedBy.length}/2 — đủ: ${signed.preview.enough}`);
  const hash = await B.submitRequest(signed.request);
  console.log("✓ Đã gửi giao dịch:", hash, "\n  https://preprod.cardanoscan.io/transaction/" + hash);

  console.log("Đợi xác nhận trên chuỗi…");
  for (let t = 0; t < 40; t++) {
    await sleep(15_000);
    const now = await lov(B).catch(() => before);
    if (now >= before + SEND) {
      console.log(`✓ XÁC NHẬN: ví B nhận ${ada(now - before)} tADA (số dư ${ada(now)})`);
      console.log(`  Multisig còn ${ada(await multi())} tADA`);
      console.log("\nHOÀN TẤT: luồng multisig 2-of-2 trên Preprod chạy thật.");
      return;
    }
  }
  throw new Error("Chưa thấy xác nhận sau 10 phút (giao dịch có thể vẫn đang chờ khối)");
}

const cmd = process.argv[2];
({ setup, run, status } as Record<string, () => Promise<void>>)[cmd ?? ""]?.().catch((e) => { console.error("LỖI:", e instanceof Error ? e.message : e); process.exit(1); }) ?? console.log("Dùng: setup | run | status");

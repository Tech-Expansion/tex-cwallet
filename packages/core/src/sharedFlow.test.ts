import { describe, it, expect, beforeEach } from "vitest";
import { Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, parseRegistration, type ProviderFactory, type Registration } from "./index";

const M = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
];
const PW = "correct-horse";
const DEST = "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";

// "Chuỗi" giả dùng chung cho cả ba người dùng: theo dõi UTxO đã tiêu và giao dịch đã lên chuỗi
let onChain: Registration[];
let submitted: string[];
let spentRefs: Set<string>;
let landed: Set<string>;
const refOf = (address: string) => ({ txHash: Buffer.from(address).toString("hex").slice(0, 64).padEnd(64, "0"), outputIndex: 1 });
const providers: ProviderFactory = () => ({
  fetcher: {
    fetchAddressUTxOs: async (address: string) => {
      const r = refOf(address);
      return spentRefs.has(`${r.txHash}#${r.outputIndex}`) ? [] : [{ input: r, output: { address, amount: [{ unit: "lovelace", quantity: "80000000" }] } }];
    },
  } as never,
  submitter: {
    submitTx: async (tx: string) => {
      const t = Serialization.Transaction.fromCbor(tx as never);
      const refs = t.body().inputs().values().map((i) => `${i.transactionId()}#${i.index()}`);
      // giống node thật: UTxO đã bị tiêu thì từ chối
      if (refs.some((r) => spentRefs.has(r))) throw new Error('{"error":["ConwayMempoolFailure \\"All inputs are spent. Transaction has probably already been included\\""]}');
      refs.forEach((r) => spentRefs.add(r));
      submitted.push(tx);
      landed.add(resolveTxHash(tx));
      const reg = parseRegistration(tx);
      if (reg) onChain.push({ ...reg, txHash: "reg" + onChain.length });
      return resolveTxHash(tx);
    },
  } as never,
  chain: {
    getBalance: async () => [{ unit: "lovelace", quantity: "80000000" }],
    getHistory: async () => [],
    getProtocolParams: async () => { throw new Error("no params"); },
    findRegistrations: async (creds: string[]) => onChain.filter((r) => JSON.stringify(r.payment).split('"').some((x) => creds.includes(x))),
    txExists: async (h: string) => landed.has(h),
  },
});

async function user(i: number) {
  const m = new WalletManager(new MemoryStore(), providers);
  await m.setupPassword(PW);
  await m.addWallet(`U${i}`, M[i]!);
  return m;
}

let A: WalletManager, B: WalletManager, C: WalletManager;
beforeEach(async () => {
  onChain = [];
  submitted = [];
  spentRefs = new Set();
  landed = new Set();
  [A, B, C] = [await user(0), await user(1), await user(2)];
});

async function createWallet() {
  const kb = (await B.sharedKeyInfo(0)).keyHash, kc = (await C.sharedKeyInfo(0)).keyHash;
  return A.createShared({ name: "Quỹ nhóm", required: 2, cosigners: [{ name: "Bình", keyHash: kb }, { name: "Chi", keyHash: kc }], myName: "An" });
}

describe("multisig kiểu Eternl: tạo → đăng ký → khám phá → đề xuất → ký → gửi", () => {
  it("toàn bộ luồng 2-of-3 giữa ba người dùng", async () => {
    const w = await createWallet();
    expect(w.required).toBe(2);
    expect(w.address.startsWith("addr_test1w")).toBe(true);
    expect(w.myIndex).toBe(0);

    // A đăng ký on-chain (phí trả từ ví thường), B tự khám phá — không cần gửi file
    const regHash = await A.registerShared(w.id);
    expect(regHash).toHaveLength(64);
    expect(onChain.length).toBe(1);
    const found = await B.discoverShared();
    expect(found.length).toBe(1);
    expect(found[0]!.address).toBe(w.address);
    expect(found[0]!.name).toBe("Quỹ nhóm");
    expect(found[0]!.myIndex).toBe(0);
    expect(found[0]!.signers.map((s) => s.name).sort()).toEqual(["An", "Bình", "Chi"]);

    // C nhập từ bản xuất của A
    const imported = await C.importShared(A.exportShared(w.id));
    expect(imported.address).toBe(w.address);
    expect(imported.myIndex).toBe(0);
    expect(await C.sharedBalance(imported.id)).toEqual([{ unit: "lovelace", quantity: "80000000" }]);

    // A đề xuất (đã ký 1/2), gửi sớm thì bị chặn
    const req = await A.proposeShared(w.id, DEST, 5_000_000n, "Trả tiền thuê");
    await expect(A.submitRequest(req)).rejects.toMatchObject({ code: "NOT_ENOUGH" });
    const listA = await A.listRequests(w.id);
    expect(listA.length).toBe(1);
    expect(listA[0]!.preview.signedBy.length).toBe(1);
    expect(listA[0]!.iSigned).toBe(true);
    expect(listA[0]!.memo).toBe("Trả tiền thuê");

    // B kiểm tra theo CIP-1854 (có chữ ký của A) rồi ký → đủ 2/2
    const info = await B.inspectRequest(req);
    expect(info.iSigned).toBe(false);
    expect(info.preview.outputs.some((o) => o.address === DEST && o.lovelace === "5000000")).toBe(true);
    await expect(B.signRequest(req, "sai-mat-khau")).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    const signed = await B.signRequest(req, PW);
    expect(signed.preview.enough).toBe(true);
    expect(signed.preview.signedBy.length).toBe(2);

    // gửi: giao dịch lên mạng có 2 chữ ký + script
    const hash = await B.submitRequest(signed.request);
    expect(hash).toHaveLength(64);
    const last = Serialization.Transaction.fromCbor(submitted.at(-1) as never);
    expect(last.witnessSet().vkeys()?.size()).toBe(2);
    expect(last.witnessSet().nativeScripts()?.size()).toBe(1);
    expect((await B.listRequests(w.id)).length).toBe(0); // đã gửi thì bỏ khỏi danh sách chờ
  });

  it("ký hai nơi rồi gộp chữ ký (không cần chuyền tuần tự)", async () => {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    await C.importShared(A.exportShared(w.id));
    const base = await A.proposeShared(w.id, DEST, 3_000_000n); // A đã ký
    const fromB = (await B.signRequest(base, PW)).request;
    const fromC = (await C.signRequest(base, PW)).request;
    const merged = await A.mergeRequests(fromB, fromC);
    expect(merged.preview.signedBy.length).toBe(3);
    expect(merged.preview.enough).toBe(true);
    // gộp hai giao dịch khác nhau bị từ chối
    const other = await A.proposeShared(w.id, DEST, 4_000_000n);
    await expect(A.mergeRequests(fromB, other)).rejects.toMatchObject({ code: "INVALID_TX" });
  });

  it("từ chối yêu cầu ký đáng ngờ", async () => {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    await C.importShared(A.exportShared(w.id));
    const req = JSON.parse(await A.proposeShared(w.id, DEST, 3_000_000n));
    // 1. rác / sai định dạng
    await expect(B.inspectRequest("không phải json")).rejects.toMatchObject({ code: "INVALID_TX" });
    await expect(B.inspectRequest(JSON.stringify({ ...req, kind: "khac" }))).rejects.toMatchObject({ code: "INVALID_TX" });
    // 2. ví không tồn tại với người nhận
    await expect(B.inspectRequest(JSON.stringify({ ...req, walletId: "preprod-" + "0".repeat(56) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // 3. sai mạng
    await expect(B.inspectRequest(JSON.stringify({ ...req, network: "preview" }))).rejects.toThrow(/mạng/);
    // 4. giao dịch chưa có chữ ký của cosigner nào khác (không xác minh được nguồn gốc) → cần chữ ký người khác
    const unsigned = JSON.parse(await C.proposeShared(w.id, DEST, 3_000_000n));
    unsigned.tx = unsigned.tx.replace(/^(.*)$/, (t: string) => {
      const x = Serialization.Transaction.fromCbor(t as never);
      const ws = x.witnessSet();
      ws.setVkeys(Serialization.CborSet.fromCore([], Serialization.VkeyWitness.fromCore) as never);
      x.setWitnessSet(ws);
      return x.toCbor();
    });
    await expect(B.inspectRequest(JSON.stringify(unsigned))).rejects.toThrow(/nguồn gốc/);
    // 5. ví ngoài danh sách cosigner không ký được
    const stranger = await user(0);
    await expect(stranger.inspectRequest(JSON.stringify(req))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("khám phá chống replay: script sao chép dùng chung khóa chỉ lấy bản đăng ký cũ nhất", async () => {
    const w = await createWallet();
    await A.registerShared(w.id);
    // kẻ xấu đăng ký lại một script khác chứa khóa của B
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    const evil = await A.createShared({ name: "Giả mạo", required: 1, cosigners: [{ name: "B", keyHash: kb }], myIndex: 3 });
    await A.registerShared(evil.id).catch(() => undefined);
    const found = await B.discoverShared();
    expect(found.map((f) => f.name)).toContain("Quỹ nhóm");
  });

  it("cấu hình sai bị từ chối; ví xuất/nhập không đổi địa chỉ; xóa ví", async () => {
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    await expect(A.createShared({ name: "x", required: 3, cosigners: [{ name: "B", keyHash: kb }] })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(A.createShared({ name: "x", required: 1, cosigners: [{ name: "B", keyHash: "xyz" }] })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    const mine = (await A.sharedKeyInfo(0)).keyHash;
    await expect(A.createShared({ name: "x", required: 1, cosigners: [{ name: "tôi", keyHash: mine }] })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    const w = await createWallet();
    const kc = (await C.sharedKeyInfo(0)).keyHash;
    // cùng cosigner nhưng không chỉ định chỉ số → tự dùng khóa mới (y=1) nên là ví khác, không trùng
    const second = await A.createShared({ name: "Thứ hai", required: 2, cosigners: [{ name: "B", keyHash: kb }, { name: "C", keyHash: kc }] });
    expect(second.myIndex).toBe(1);
    expect(second.address).not.toBe(w.address);
    // chỉ định đúng chỉ số cũ thì ra đúng ví cũ → bị chặn vì trùng
    await expect(A.createShared({ name: "Trùng", required: 2, cosigners: [{ name: "B", keyHash: kb }, { name: "C", keyHash: kc }], myIndex: 0 })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await A.removeShared(w.id);
    await A.removeShared(second.id);
    expect(A.listShared().length).toBe(0);
    await expect(C.importShared("zzzz")).rejects.toBeTruthy();
    await expect(C.importShared("{}")).rejects.toBeTruthy();
  });

  it("dữ liệu bền vững: nạp lại từ storage vẫn thấy ví và yêu cầu chờ", async () => {
    const store = new MemoryStore();
    const a1 = new WalletManager(store, providers);
    await a1.setupPassword(PW);
    await a1.addWallet("U0", M[0]!);
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    const w = await a1.createShared({ name: "Bền", required: 1, cosigners: [{ name: "B", keyHash: kb }] });
    await a1.proposeShared(w.id, DEST, 2_000_000n);
    const a2 = new WalletManager(store, providers);
    await a2.load();
    await a2.unlock(PW);
    expect(a2.listShared().map((x) => x.id)).toEqual([w.id]);
    expect((await a2.listRequests(w.id)).length).toBe(1);
  });

  it("chỉ số khóa tự điền: ví đầu dùng 0, ví tiếp theo tự dùng 1, 2…", async () => {
    expect((await A.sharedNextIndex()).y).toBe(0);
    const kb = (await B.sharedKeyInfo(0)).keyHash, kc = (await C.sharedKeyInfo(0)).keyHash;
    const w1 = await A.createShared({ name: "Một", required: 1, cosigners: [{ name: "B", keyHash: kb }] });
    expect(w1.myIndex).toBe(0);
    expect((await A.sharedNextIndex()).y).toBe(1);
    const w2 = await A.createShared({ name: "Hai", required: 1, cosigners: [{ name: "C", keyHash: kc }] });
    expect(w2.myIndex).toBe(1); // không cần người dùng chọn
    expect((await A.sharedNextIndex()).y).toBe(2);
    expect((await A.sharedNextIndex()).keyHash).not.toBe((await A.sharedKeyInfo(0)).keyHash);
  });

  it("cosigner khác đã gửi rồi: danh sách tự dọn, gửi lại không báo lỗi", async () => {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    const req = await A.proposeShared(w.id, DEST, 3_000_000n);
    const signed = (await B.signRequest(req, PW)).request;
    const hash = await B.submitRequest(signed); // B gửi
    expect(landed.has(hash)).toBe(true);
    expect(await A.listRequests(w.id)).toEqual([]); // A thấy yêu cầu đã lên chuỗi → tự bỏ
    // A vẫn giữ bản đã ký đủ và bấm gửi lại (ví dụ trên một thiết bị khác) → thành công, không phải lỗi 400
    const merged = (await A.mergeRequests(req, signed)).request;
    expect(await A.submitRequest(merged)).toBe(hash);
  });

  it("UTxO bị đề xuất khác tiêu mất: yêu cầu cũ bị đánh dấu lỗi thời và báo lỗi dễ hiểu", async () => {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    const r1 = await A.proposeShared(w.id, DEST, 3_000_000n);
    const r2 = await A.proposeShared(w.id, DEST, 4_000_000n); // cùng UTxO nên xung đột
    const s1 = (await B.signRequest(r1, PW)).request;
    const s2 = (await B.signRequest(r2, PW)).request;
    await B.submitRequest(s1);
    const list = await A.listRequests(w.id);
    expect(list.length).toBe(1);
    expect(list[0]!.stale).toBe(true);
    const e = (await B.submitRequest(s2).catch((x) => x)) as Error;
    expect(String(e.message)).toMatch(/đã bị tiêu/);
    expect(String(e.message)).toMatch(/tạo đề xuất mới/);
    expect(String(e.message)).not.toContain("ConwayMempoolFailure\\"); // không lộ lỗi thô ở đầu thông báo
  });
});

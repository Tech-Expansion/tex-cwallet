import { describe, it, expect, beforeEach } from "vitest";
import { Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { WalletManager, MemoryStore, parseRegistration, signWithSharedKey, attachWitnesses, sharedPublicKey, scriptCborOf, SHARED_TTL_SLOTS, type ProviderFactory, type Registration } from "./index";

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
let tipSlot = 1_000;
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
    getTip: async () => ({ hash: "b".repeat(64), epoch: 180, slot: tipSlot, blockHeight: 1, blockTime: 0 }),
    getBalance: async () => [{ unit: "lovelace", quantity: "80000000" }],
    getHistory: async () => [],
    listAddressTxs: async () => [],
    getTxs: async () => [],
    getProtocolParams: async () => DEFAULT_PROTOCOL_PARAMETERS,
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
  tipSlot = 1_000;
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

describe("AI-8: đề xuất → co-sign → submit khi đủ chữ ký", () => {
  async function setup2of3() {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    await C.importShared(A.exportShared(w.id));
    return w;
  }

  it("AC-001: 2-of-3 — một người ký thì bị chặn, hai người ký thì submit được", async () => {
    const w = await setup2of3();
    const req = await A.proposeShared(w.id, DEST, 5_000_000n); // A signs (1/2)
    await expect(A.submitRequest(req)).rejects.toMatchObject({ code: "NOT_ENOUGH" });
    await expect(C.submitRequest(req)).rejects.toMatchObject({ code: "NOT_ENOUGH" });
    expect(submitted).toHaveLength(0);
    const signed = await C.signRequest(req, PW); // C signs (2/2)
    expect(signed.preview.enough).toBe(true);
    expect(await C.submitRequest(signed.request)).toHaveLength(64);
    expect(submitted).toHaveLength(1);
  });

  it("người ký thấy rõ đi đâu, bao nhiêu, phí bao nhiêu, hạn tới slot nào", async () => {
    const w = await setup2of3();
    const req = await A.proposeShared(w.id, DEST, 7_000_000n);
    const info = await B.inspectRequest(req);
    const dest = info.preview.outputs.filter((o) => !o.change);
    expect(dest).toEqual([{ address: DEST, lovelace: "7000000", tokens: 0, change: false }]);
    expect(BigInt(info.preview.fee) > 0n).toBe(true);
    expect(info.preview.ttl).toBe(1_000 + SHARED_TTL_SLOTS);
  });

  it("AC-002: chữ ký của key ngoài script bị từ chối (khi xem, khi ký, khi submit)", async () => {
    const w = await setup2of3();
    const req = JSON.parse(await A.proposeShared(w.id, DEST, 3_000_000n));
    const outsider = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above".split(" ");
    const forged = { ...req, tx: attachWitnesses(req.tx, [await signWithSharedKey(outsider, 7, req.tx)]) }; // key not in the script
    await expect(B.inspectRequest(JSON.stringify(forged))).rejects.toMatchObject({ code: "NOT_SIGNER" });
    await expect(B.signRequest(JSON.stringify(forged), PW)).rejects.toMatchObject({ code: "NOT_SIGNER" });
    await expect(A.submitRequest(JSON.stringify(forged))).rejects.toMatchObject({ code: "NOT_SIGNER" });
    expect(submitted).toHaveLength(0);
  });

  it("AC-003: giao dịch bị sửa sau khi ký thì chữ ký cũ không còn hợp lệ", async () => {
    const w = await setup2of3();
    const req = JSON.parse(await A.proposeShared(w.id, DEST, 3_000_000n)); // carries A's signature
    const t = Serialization.Transaction.fromCbor(req.tx as never);
    const body = t.body();
    body.setFee(body.fee() + 1n); // change the body, keep A's witness
    t.setBody(body);
    const tampered = { ...req, tx: t.toCbor() };
    expect(resolveTxHash(tampered.tx)).not.toBe(resolveTxHash(req.tx));
    await expect(B.inspectRequest(JSON.stringify(tampered))).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(B.signRequest(JSON.stringify(tampered), PW)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    // B's signature on the original cannot be merged into the tampered one
    const fromB = (await B.signRequest(JSON.stringify(req), PW)).request;
    await expect(A.mergeRequests(fromB, JSON.stringify(tampered))).rejects.toThrow();
  });

  it("có thời hạn: quá hạn thì không ký, không submit được và phải đề xuất lại", async () => {
    const w = await setup2of3();
    const req = await A.proposeShared(w.id, DEST, 3_000_000n);
    const signed = (await B.signRequest(req, PW)).request; // 2/2 before expiry
    tipSlot = 1_000 + SHARED_TTL_SLOTS; // expiry reached
    await expect(C.inspectRequest(req)).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(C.signRequest(req, PW)).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(B.submitRequest(signed)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(submitted).toHaveLength(0);
    expect((await A.listRequests(w.id))[0]!.expired).toBe(true);
    // propose again: the new validity end counts from the current tip
    const again = await A.proposeShared(w.id, DEST, 3_000_000n);
    expect((await B.inspectRequest(again)).preview.ttl).toBe(tipSlot + SHARED_TTL_SLOTS);
  });

  it("trao đổi bằng CBOR giao dịch chuẩn (dùng được với ví Cardano khác)", async () => {
    const w = await setup2of3();
    const req = await A.proposeShared(w.id, DEST, 3_000_000n);
    const cbor = A.requestCbor(req);
    expect(cbor).toMatch(/^[0-9a-f]+$/);
    expect(() => Serialization.Transaction.fromCbor(cbor as never)).not.toThrow();
    const info = await B.inspectRequest(cbor); // B pastes raw CBOR, the wallet is found by its script
    expect(info.wallet.id).toBe(w.id);
    const signed = await B.signRequest(cbor, PW);
    expect(signed.preview.enough).toBe(true);
    expect(await B.submitRequest(B.requestCbor(signed.request))).toHaveLength(64);
    const stranger = await user(2);
    await expect(stranger.inspectRequest(cbor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AI-11: paste anything, merge signatures automatically", () => {
  async function setup2of3() {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    await C.importShared(A.exportShared(w.id));
    return w;
  }

  it("detectSharedInput recognizes keys, wallet data and sign requests", async () => {
    const w = await setup2of3();
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    expect(await A.detectSharedInput(kb)).toEqual({ kind: "cosignerKey", keyHash: kb });
    expect(await A.detectSharedInput(`  ${kb.toUpperCase()}\n`)).toEqual({ kind: "cosignerKey", keyHash: kb });
    expect(await A.detectSharedInput(sharedPublicKey(M[1]!.split(" "), 0))).toEqual({ kind: "cosignerKey", keyHash: kb });
    expect((await A.detectSharedInput(DEST)).kind).toBe("cosignerKey"); // address with a payment key
    expect(await A.detectSharedInput(A.exportShared(w.id))).toEqual({ kind: "wallet" });
    expect(await A.detectSharedInput(scriptCborOf(w.paymentScript))).toEqual({ kind: "wallet" });
    const req = await A.proposeShared(w.id, DEST, 3_000_000n);
    expect(await B.detectSharedInput(req)).toEqual({ kind: "signRequest", walletId: w.id });
    expect(await B.detectSharedInput(A.requestCbor(req))).toEqual({ kind: "signRequest", walletId: w.id });
    for (const junk of ["", "hello", "{}", "{not json", "abcd", w.address]) expect((await A.detectSharedInput(junk)).kind).toBe("unknown");
    await expect(A.detectSharedInput("ab".repeat(64))).rejects.toThrow(/bí mật/);
    await expect(A.detectSharedInput("addr_xsk1qqqq")).rejects.toThrow(/bí mật/);
  });

  it("receiveRequest stores a new request, then merges a copy with more signatures", async () => {
    const w = await setup2of3();
    const base = await A.proposeShared(w.id, DEST, 3_000_000n); // A signed (1/2)
    const first = await B.receiveRequest(base);
    expect(first).toMatchObject({ walletId: w.id, merged: false });
    expect(first.preview.signedBy).toHaveLength(1);
    expect(await B.listRequests(w.id)).toHaveLength(1);
    const fromC = (await C.signRequest(base, PW)).request; // C signs its own copy (2/2)
    const second = await B.receiveRequest(fromC);
    expect(second.merged).toBe(true);
    expect(new Set(second.preview.signedBy).size).toBe(2);
    expect(second.preview.enough).toBe(true);
    expect(await B.listRequests(w.id)).toHaveLength(1); // still one request, now complete
    expect(await B.submitRequest(second.request)).toHaveLength(64);
  });

  it("receiveRequest keeps every safety check", async () => {
    const w = await setup2of3();
    const req = JSON.parse(await A.proposeShared(w.id, DEST, 3_000_000n));
    const outsider = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above".split(" ");
    await expect(B.receiveRequest(JSON.stringify({ ...req, tx: attachWitnesses(req.tx, [await signWithSharedKey(outsider, 9, req.tx)]) }))).rejects.toMatchObject({ code: "NOT_SIGNER" });
    const t = Serialization.Transaction.fromCbor(req.tx as never);
    const body = t.body();
    body.setFee(body.fee() + 1n);
    t.setBody(body);
    await expect(B.receiveRequest(JSON.stringify({ ...req, tx: t.toCbor() }))).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    tipSlot = 1_000 + SHARED_TTL_SLOTS;
    await expect(B.receiveRequest(JSON.stringify(req))).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await B.listRequests(w.id)).toHaveLength(0);
  });
});

describe("AI-13: preview the multisig address before creating it", () => {
  it("previewShared matches createShared and saves nothing", async () => {
    const kb = (await B.sharedKeyInfo(0)).keyHash, kc = (await C.sharedKeyInfo(0)).keyHash;
    const cosigners = [{ name: "Bình", keyHash: kb }, { name: "Chi", keyHash: kc }];
    const p = await A.previewShared({ required: 2, cosigners });
    expect(p).toMatchObject({ required: 2, total: 3, myIndex: 0 });
    expect(p.address).toMatch(/^addr_test1w/);
    expect(A.listShared()).toHaveLength(0); // nothing saved
    // key order does not change the address
    expect((await A.previewShared({ required: 2, cosigners: [...cosigners].reverse() })).address).toBe(p.address);
    // a CIP-1854 public key gives the same address as its key hash
    expect((await A.previewShared({ required: 2, cosigners: [{ name: "Bình", keyHash: sharedPublicKey(M[1]!.split(" "), 0) }, cosigners[1]!] })).address).toBe(p.address);
    const w = await A.createShared({ name: "Quỹ", required: 2, cosigners, myIndex: p.myIndex });
    expect(w.address).toBe(p.address);
    expect(w.myIndex).toBe(p.myIndex);
    // the next preview uses my next unused key, so it is a different wallet; the same index gives the same one
    const next = await A.previewShared({ required: 2, cosigners });
    expect(next.myIndex).toBe(1);
    expect(next.address).not.toBe(p.address);
    expect((await A.previewShared({ required: 2, cosigners, myIndex: p.myIndex })).address).toBe(p.address);
    await expect(A.createShared({ name: "Lại", required: 2, cosigners, myIndex: p.myIndex })).rejects.toThrow(/đã tồn tại/);
  });

  it("previewShared rejects bad settings like createShared", async () => {
    const kb = (await B.sharedKeyInfo(0)).keyHash;
    await expect(A.previewShared({ required: 3, cosigners: [{ name: "B", keyHash: kb }] })).rejects.toThrow();
    await expect(A.previewShared({ required: 1, cosigners: [{ name: "B", keyHash: "xyz" }] })).rejects.toThrow();
    await expect(A.previewShared({ required: 1, cosigners: [{ name: "B", keyHash: (await A.sharedKeyInfo(0)).keyHash }] })).rejects.toThrow(/tự động/);
  });
});

describe("AI-14: request inbox", () => {
  it("pendingActionCount counts requests I can sign and ones ready to submit", async () => {
    const w = await createWallet();
    await B.importShared(A.exportShared(w.id));
    await C.importShared(A.exportShared(w.id));
    expect(await A.pendingActionCount()).toBe(0);
    const req = await A.proposeShared(w.id, DEST, 3_000_000n); // A signed, 1/2
    expect(await A.pendingActionCount()).toBe(0); // nothing left for A to do
    await B.receiveRequest(req);
    expect(await B.pendingActionCount()).toBe(1); // B can sign
    const signed = await B.signRequest(req, PW); // 2/2
    expect(signed.preview.enough).toBe(true);
    expect(await B.pendingActionCount()).toBe(1); // ready to submit
    await B.submitRequest(signed.request);
    expect(await B.pendingActionCount()).toBe(0);
  });

  it("listRequests reports the slots left before expiry", async () => {
    const w = await createWallet();
    await A.proposeShared(w.id, DEST, 3_000_000n);
    expect((await A.listRequests(w.id))[0]!.slotsLeft).toBe(SHARED_TTL_SLOTS);
    tipSlot += 3_600;
    expect((await A.listRequests(w.id))[0]!.slotsLeft).toBe(SHARED_TTL_SLOTS - 3_600);
    tipSlot = 1_000 + SHARED_TTL_SLOTS + 10;
    const late = (await A.listRequests(w.id))[0]!;
    expect(late).toMatchObject({ slotsLeft: 0, expired: true });
  });
});

describe("AI-15: several wallets on one device", () => {
  it("each wallet signs with its own key; sign requests are shared on the device", async () => {
    const m = new WalletManager(new MemoryStore(), providers);
    await m.setupPassword(PW);
    const v1 = await m.addWallet("V1", M[0]!), v2 = await m.addWallet("V2", M[1]!), v3 = await m.addWallet("V3", M[2]!);
    await m.setActive(v2.id);
    const k2 = (await m.sharedKeyInfo(0)).keyHash;
    await m.setActive(v3.id);
    const k3 = (await m.sharedKeyInfo(0)).keyHash;

    // wallet 1 creates a 2-of-3 and proposes (signed by wallet 1)
    await m.setActive(v1.id);
    const ms = await m.createShared({ name: "Quỹ", required: 2, cosigners: [{ name: "V2", keyHash: k2 }, { name: "V3", keyHash: k3 }] });
    await m.proposeShared(ms.id, DEST, 3_000_000n);
    expect((await m.listRequests(ms.id))[0]!.iSigned).toBe(true);
    const exported = m.exportShared(ms.id);

    // wallet 2 picks up the multisig wallet held by wallet 1 on this device (it holds one of wallet 2's keys)
    await m.setActive(v2.id);
    const adopted = await m.adoptLocalShared();
    expect(adopted.map((w) => w.id)).toEqual([ms.id]);
    expect(adopted[0]!.myIndex).toBe(0);
    expect(m.listShared()).toHaveLength(1);
    expect(await m.adoptLocalShared()).toHaveLength(0); // only once
    expect((await m.importShared(exported)).id).toBe(ms.id); // importing again just updates it
    expect(await m.pendingActionCount()).toBe(1);
    const list = await m.listRequests(ms.id);
    expect(list).toHaveLength(1); // the request created by wallet 1 is visible
    expect(list[0]!.iSigned).toBe(false); // the bug: it said "already signed"
    const signed = await m.signRequest(list[0]!.request, PW);
    expect(signed.preview.signedBy).toContain(k2); // signed with wallet 2's key, not wallet 1's
    expect(new Set(signed.preview.signedBy).size).toBe(2);
    expect(await m.submitRequest(signed.request)).toHaveLength(64);

    // a wallet whose keys are not in the script does not get it
    const m2 = new WalletManager(new MemoryStore(), providers);
    await m2.setupPassword(PW);
    await m2.addWallet("A", M[0]!);
    const other = await m2.addWallet("X", m2.newMnemonic());
    await m2.createShared({ name: "Riêng", required: 1, cosigners: [{ name: "V2", keyHash: k2 }] });
    await m2.setActive(other.id);
    expect(await m2.adoptLocalShared()).toHaveLength(0);

    // removing wallet 2's copy leaves wallet 1's; removing wallet 1 drops its entries
    await m.removeShared(ms.id);
    expect(m.listShared()).toHaveLength(0);
    expect(await m.adoptLocalShared()).toHaveLength(0); // removed on purpose: not adopted again
    expect((await m.importShared(exported)).id).toBe(ms.id); // an explicit import brings it back
    expect(m.listShared()).toHaveLength(1);
    await m.removeShared(ms.id);
    await m.setActive(v1.id);
    expect(m.listShared()).toHaveLength(1);
    await m.removeWallet(v1.id);
    await m.setActive(v3.id);
    expect(m.listShared()).toHaveLength(0);
  });

  it("accounts of the same mnemonic share one multisig key (CIP-0146 uses account 0)", async () => {
    const m = new WalletManager(new MemoryStore(), providers);
    await m.setupPassword(PW);
    const v1 = await m.addWallet("V1", M[0]!);
    const k = (await m.sharedKeyInfo(0)).keyHash;
    await m.addAccount(v1.id);
    await m.setActive(v1.id, 1);
    expect((await m.sharedKeyInfo(0)).keyHash).toBe(k);
  });
});


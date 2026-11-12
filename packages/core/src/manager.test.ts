import { describe, it, expect, beforeEach } from "vitest";
import { checkSignature, deserializeAddress } from "@meshsdk/core";
import { Serialization, addVKeyWitnessSetToTransaction, Address } from "@meshsdk/core-cst";
import { summarizeTx, WalletManager, MemoryStore, KoiosClient, WalletError, type ProviderFactory } from "./index";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const M2 = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PW = "correct-horse";

let submitted: string[] = [];
let utxoAddr = "";
const factory: ProviderFactory = (network) => ({
  fetcher: {
    fetchAddressUTxOs: async (address: string) => [
      { input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: "50000000" }] } },
    ],
  } as any,
  submitter: { submitTx: async (tx: string) => (submitted.push(tx), "f".repeat(64)) } as any,
  chain: new KoiosClient(network, (async (url: string) => {
    const u = String(url);
    const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
    if (u.endsWith("/address_info"))
      return json([{ balance: "5000000", utxo_set: [{ asset_list: [{ policy_id: "ab", asset_name: "cd", quantity: "3" }] }] }]);
    if (u.endsWith("/address_txs")) return json([{ tx_hash: "t1", block_time: 10 }, { tx_hash: "t2", block_time: 20 }]);
    if (u.endsWith("/tx_info"))
      return json([
        { tx_hash: "t1", outputs: [{ payment_addr: { bech32: utxoAddr }, value: "7000000" }], inputs: [] },
        { tx_hash: "t2", outputs: [], inputs: [{ payment_addr: { bech32: utxoAddr }, value: "2000000" }] },
      ]);
    return { ok: false, status: 404 } as Response;
  }) as any),
});

let store: MemoryStore;
let m: WalletManager;
beforeEach(() => {
  submitted = [];
  store = new MemoryStore();
  m = new WalletManager(store, factory);
});

async function ready() {
  await m.setupPassword(PW);
  const w = await m.addWallet("Chính", M);
  utxoAddr = (await m.getAccount()).baseAddress;
  return w;
}

describe("WalletManager", () => {
  it("từ chối mật khẩu yếu và thao tác khi đang khóa", async () => {
    await expect(m.setupPassword("123")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await m.setupPassword(PW);
    m.lock();
    await expect(m.addWallet("x", M)).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("unlock đúng/sai mật khẩu, dữ liệu persist qua instance mới", async () => {
    await ready();
    const m2 = new WalletManager(store, factory);
    await m2.load();
    expect(m2.hasVault()).toBe(true);
    expect(m2.listWallets()).toHaveLength(1);
    await expect(m2.unlock("sai-mat-khau")).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    await m2.unlock(PW);
    expect((await m2.getAccount()).baseAddress).toBe(utxoAddr);
  });

  it("không lưu mnemonic dạng rõ trong storage", async () => {
    await ready();
    expect(JSON.stringify(await store.get("wallet-state-v1"))).not.toContain("abandon");
  });

  it("nhiều ví, nhiều account, chuyển active", async () => {
    const w1 = await ready();
    const w2 = await m.addWallet("Phụ", M2.split(" "));
    expect(m.listWallets()).toHaveLength(2);
    const a0 = (await m.getAccount(w1.id, 0)).baseAddress;
    const idx = await m.addAccount(w1.id);
    expect(idx).toBe(1);
    await m.setActive(w1.id, 1);
    expect((await m.getAccount()).baseAddress).not.toBe(a0);
    await m.setActive(w2.id);
    expect(m.active.walletId).toBe(w2.id);
    await expect(m.addWallet("dup", M)).rejects.toMatchObject({ code: "INVALID_MNEMONIC" });
    await expect(m.addWallet("bad", "foo bar")).rejects.toMatchObject({ code: "INVALID_MNEMONIC" });
  });

  it("xóa ví chuyển active sang ví còn lại", async () => {
    const w1 = await ready();
    const w2 = await m.addWallet("Phụ", M2);
    await m.removeWallet(w1.id);
    expect(m.active.walletId).toBe(w2.id);
    expect(m.listWallets()).toHaveLength(1);
  });

  it("watch-only: đọc được nhưng không ký", async () => {
    await ready();
    const w = await m.addWatchWallet("W", utxoAddr);
    await m.setActive(w.id);
    expect((await m.getBalance()).find((b) => b.unit === "lovelace")?.quantity).toBe("5000000");
    await expect(m.sendAda(utxoAddr, 2_000_000n)).rejects.toBeInstanceOf(WalletError);
    await expect(m.addWatchWallet("bad", "addr1xyz")).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });

  it("export mnemonic cần đúng mật khẩu", async () => {
    const w = await ready();
    expect((await m.exportMnemonic(w.id, PW)).join(" ")).toBe(M);
    await expect(m.exportMnemonic(w.id, "nope-nope")).rejects.toMatchObject({ code: "BAD_PASSWORD" });
  });

  it("số dư gồm cả native token; lịch sử tính net đúng", async () => {
    await ready();
    const bal = await m.getBalance();
    expect(bal).toContainEqual({ unit: "lovelace", quantity: "5000000" });
    expect(bal).toContainEqual({ unit: "abcd", quantity: "3" });
    const h = await m.getHistory();
    expect(h.map((t) => [t.hash, t.netLovelace])).toEqual([["t2", -2000000n], ["t1", 7000000n]]);
  });

  it("đổi mạng preprod <-> preview", async () => {
    await ready();
    await m.setNetwork("preview");
    expect(m.network).toBe("preview");
    const m2 = new WalletManager(store, factory);
    await m2.load();
    expect(m2.network).toBe("preview");
  });

  it("gửi ADA: build, ký, submit", async () => {
    await ready();
    const to = (await new WalletManager(new MemoryStore(), factory).deriveFor(M2)).baseAddress;
    const txHash = await m.sendAda(to, 3_000_000n);
    expect(txHash).toHaveLength(64);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatch(/^[0-9a-f]+$/);
  });

  it("gửi ADA: validate đầu vào", async () => {
    await ready();
    await expect(m.sendAda("addr1bad", 2_000_000n)).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.sendAda(utxoAddr, 10n)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(m.sendAda(utxoAddr, 900_000_000n)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("CIP-30: địa chỉ/utxo/balance dạng hex, signTx hoạt động", async () => {
    await ready();
    const api = await m.cip30();
    expect(await api.getNetworkId()).toBe(0);
    expect((await api.getUsedAddresses())[0]).toMatch(/^[0-9a-f]+$/);
    expect(await api.getBalance()).toMatch(/^[0-9a-f]+$/);
    expect((await api.getUtxos())).toHaveLength(1);
  });

  it("summarizeTx liệt kê output và phí", async () => {
    await ready();
    const to = (await m.deriveFor(M2)).baseAddress;
    const { signedTx } = await m.buildSendAda(to, 3_000_000n);
    const s = summarizeTx(signedTx);
    expect(s).toContain(to);
    expect(s).toContain("3 ADA");
    expect(s).toMatch(/Phí: 0\.\d+ ADA/);
    expect(summarizeTx("zz")).toContain("Không giải mã");
  });

  it("CIP-30 signTx trả WITNESS SET (không phải cả giao dịch), ghép lại được và có thể ký từng phần", async () => {
    await ready();
    const to = (await m.deriveFor(M2)).baseAddress;
    const { signedTx } = await m.buildSendAda(to, 3_000_000n);
    // lấy giao dịch chưa ký từ bản đã ký để mô phỏng dApp
    const t = Serialization.Transaction.fromCbor(signedTx as never);
    const ws = t.witnessSet();
    ws.setVkeys(Serialization.CborSet.fromCore([], Serialization.VkeyWitness.fromCore) as never);
    t.setWitnessSet(ws);
    const unsigned = t.toCbor();
    const api = await m.cip30();
    const wit = await api.signTx(unsigned, true);
    const parsed = Serialization.TransactionWitnessSet.fromCbor(wit as never);
    expect(parsed.vkeys()?.size()).toBe(1); // chỉ chứa chữ ký, không phải giao dịch
    expect(() => Serialization.Transaction.fromCbor(wit as never)).toThrow();
    const merged = addVKeyWitnessSetToTransaction(unsigned as never, wit as never);
    expect(Serialization.Transaction.fromCbor(merged as never).witnessSet().vkeys()?.size()).toBe(1);
  });

  it("CIP-30 signData: đăng nhập Mesh Multisig (ký nonce bằng địa chỉ reward, hex) và server xác minh được", async () => {
    await ready();
    const api = await m.cip30();
    const nonce = "5fd9786a30ce6821757bf5203ac2af33"; // server Mesh cấp nonce hex; Mesh fromUTF8 giữ nguyên chuỗi hex
    const [rewardHex] = await api.getRewardAddresses();
    const reward = Address.fromBytes(rewardHex as never).toBech32();
    expect(reward.startsWith("stake_test1")).toBe(true);
    const sig = await api.signData(rewardHex!, nonce);
    expect(await checkSignature(nonce, sig, reward)).toBe(true);
    expect(await checkSignature("aa".repeat(16), sig, reward)).toBe(false); // nonce khác thì sai
    // ký bằng địa chỉ thanh toán cũng hợp lệ (địa chỉ hex dạng bech32 hoặc bytes)
    const [payHex] = await api.getUsedAddresses();
    const paySig = await api.signData(payHex!, nonce);
    expect(await checkSignature(nonce, paySig, Address.fromBytes(payHex as never).toBech32())).toBe(true);
    // địa chỉ không thuộc ví thì bị từ chối
    await expect(api.signData(Address.fromBech32((await m.deriveFor(M2)).baseAddress).toBytes(), nonce)).rejects.toThrow();
  });
});

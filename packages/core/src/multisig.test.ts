import { describe, it, expect, beforeEach } from "vitest";
import {
  WalletManager, MemoryStore, buildPaymentScript, makeSharedWallet, scriptHashOf, scriptCborOf, scriptFromCbor, keysOf,
  sharedKeyHash, sharedPublicKey, cosignerKeyHash, SharedError, type ProviderFactory,
} from "./index";

/** Three test keys (public BIP-39 test vector mnemonics, NEVER for real funds). */
const W = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
].map((m) => m.split(" "));
const PW = "correct-horse";

const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

describe("AI-7: ví multisig m-of-n (native script, CIP-1854)", () => {
  it("AC-001: 2-of-3 với ba key test ra đúng script và địa chỉ preprod", async () => {
    const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
    // CIP-1854 key m/1854'/1815'/0'/0/0 of the first mnemonic (reference value, guards against silent path changes)
    expect(kh[0]).toBe("32000809732f4d5b9a53e2eec996e7c79a24963068ffbf3565318e9a");
    const script = buildPaymentScript(2, kh);
    expect(script).toEqual({ type: "atLeast", required: 2, scripts: [...kh].sort().map((keyHash) => ({ type: "sig", keyHash })) });
    const w = makeSharedWallet({ name: "Quỹ", network: "preprod", paymentScript: script });
    expect(w.required).toBe(2);
    expect(w.signers.map((s) => s.keyHash).sort()).toEqual([...kh].sort());
    expect(w.paymentScriptHash).toMatch(/^[0-9a-f]{56}$/);
    expect(w.address).toMatch(/^addr_test1w[02-9ac-hj-np-z]+$/); // enterprise script address, preprod
    // script CBOR (the format other wallets use) reads back to the same script, hash and address
    const back = scriptFromCbor(scriptCborOf(script));
    expect(scriptHashOf(back)).toBe(w.paymentScriptHash);
    expect(makeSharedWallet({ name: "x", network: "preprod", paymentScript: back }).address).toBe(w.address);
  });

  it("AC-002: đổi thứ tự key (mọi hoán vị) vẫn ra cùng script và địa chỉ", async () => {
    const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
    const addrs = new Set(permutations(kh).map((p) => makeSharedWallet({ name: "x", network: "preprod", paymentScript: buildPaymentScript(2, p) }).address));
    expect(addrs.size).toBe(1);
    const hashes = new Set(permutations(kh).map((p) => scriptHashOf(buildPaymentScript(2, p))));
    expect(hashes.size).toBe(1);
  });

  it("AC-003: m = 0, m > n, m không nguyên hoặc âm bị từ chối", async () => {
    const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
    for (const m of [0, 4, -1, 1.5, Number.NaN]) expect(() => buildPaymentScript(m, kh)).toThrow(SharedError);
    expect(() => buildPaymentScript(1, [])).toThrow(SharedError);
    expect(buildPaymentScript(3, kh).type).toBe("all");
    expect(buildPaymentScript(1, kh)).toMatchObject({ type: "atLeast", required: 1 });
  });

  it("cosigner chỉ đưa phần công khai: public key hoặc key hash; khóa bí mật bị chặn", async () => {
    const pub = sharedPublicKey(W[1]!, 0);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(await cosignerKeyHash(pub)).toBe(await sharedKeyHash(W[1]!, 0));
    expect(await cosignerKeyHash((await sharedKeyHash(W[1]!, 0)).toUpperCase())).toBe(await sharedKeyHash(W[1]!, 0));
    await expect(cosignerKeyHash("ab".repeat(64))).rejects.toThrow(/bí mật/);
    await expect(cosignerKeyHash("addr_xsk1qqqq")).rejects.toThrow(/bí mật/);
    await expect(cosignerKeyHash("không phải key")).rejects.toThrow(SharedError);
  });

  describe("qua WalletManager", () => {
    const balances = new Map<string, { unit: string; quantity: string }[]>();
    const providers: ProviderFactory = () => ({
      fetcher: { fetchAddressUTxOs: async () => [] } as never,
      submitter: {} as never,
      chain: { getBalance: async (addrs: string[]) => addrs.flatMap((a) => balances.get(a) ?? []), findRegistrations: async () => [] } as never,
    });
    let m: WalletManager;
    beforeEach(async () => {
      balances.clear();
      m = new WalletManager(new MemoryStore(), providers);
      await m.setupPassword(PW);
      await m.addWallet("Tôi", W[0]!);
    });

    it("tạo ví từ public key của người khác; cùng bộ key + m thì cùng địa chỉ bất kể thứ tự nhập", async () => {
      const cos = [
        { name: "B", keyHash: sharedPublicKey(W[1]!, 0) }, // public key
        { name: "C", keyHash: await sharedKeyHash(W[2]!, 0) }, // key hash
      ];
      const a = await m.createShared({ name: "Quỹ", required: 2, cosigners: cos, myIndex: 0 });
      const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
      expect(a.paymentScript).toEqual(buildPaymentScript(2, kh));
      expect(keysOf(a.paymentScript).sort()).toEqual([...kh].sort());
      const m2 = new WalletManager(new MemoryStore(), providers);
      await m2.setupPassword(PW);
      await m2.addWallet("C", W[2]!);
      const c = await m2.createShared({ name: "Quỹ", required: 2, cosigners: [{ name: "B", keyHash: kh[1]! }, { name: "A", keyHash: kh[0]! }], myIndex: 0 });
      expect(c.address).toBe(a.address);
      await expect(m.createShared({ name: "x", required: 0, cosigners: cos, myIndex: 0 })).rejects.toThrow(SharedError);
      await expect(m.createShared({ name: "x", required: 4, cosigners: cos, myIndex: 0 })).rejects.toThrow(SharedError);
    });

    it("AC-004: số dư địa chỉ multisig hiển thị đúng (ADA + asset, bigint)", async () => {
      const kh = await Promise.all([sharedKeyHash(W[1]!, 0), sharedKeyHash(W[2]!, 0)]);
      const w = await m.createShared({ name: "Quỹ", required: 2, cosigners: kh.map((k, i) => ({ name: `S${i}`, keyHash: k })), myIndex: 0 });
      const big = (2n ** 60n).toString();
      balances.set(w.address, [{ unit: "lovelace", quantity: "12345678" }, { unit: "e".repeat(56) + "484f534b59", quantity: big }]);
      const b = await m.sharedWalletBalance(w.id);
      expect(b.ada).toBe("12.345678");
      expect(b.assets).toEqual([{ unit: "e".repeat(56) + "484f534b59", policyId: "e".repeat(56), assetNameHex: "484f534b59", assetName: "HOSKY", quantity: 2n ** 60n }]);
      balances.clear();
      expect(await m.sharedWalletBalance(w.id)).toEqual({ lovelace: 0n, ada: "0.000000", assets: [] });
    });
  });
});

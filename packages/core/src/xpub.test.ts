import { describe, it, expect } from "vitest";
import { bech32 } from "bech32";
import { mnemonicToEntropy } from "bip39";
import { Bip32PrivateKey, Crypto } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, parseAccountKey, scanXpub, toAcctXvk, deriveAccount, GAP_LIMIT, type ProviderFactory } from "./index";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const H = (n: number) => n + 0x80000000;
async function keys(account = 0) {
  await Crypto.ready();
  const root = Bip32PrivateKey.fromBip39Entropy(Buffer.from(mnemonicToEntropy(M), "hex"), "");
  const xsk = root.derive([H(1852), H(1815), H(account)]);
  return { xvkHex: xsk.toPublic().hex() as string, xskHex: xsk.hex() as string };
}

describe("AI-27 AC-001: nhận khoá công khai, từ chối khoá bí mật", () => {
  it("acct_xvk, xpub bech32 và 128 hex đều ra cùng khoá", async () => {
    const { xvkHex } = await keys();
    expect(parseAccountKey(toAcctXvk(xvkHex))).toBe(xvkHex);
    expect(parseAccountKey(bech32.encode("xpub", bech32.toWords(Buffer.from(xvkHex, "hex")), 1000))).toBe(xvkHex);
    expect(parseAccountKey(xvkHex.toUpperCase())).toBe(xvkHex);
  });
  it("acct_xsk / xprv / hex dài (khoá bí mật) bị từ chối, không lặp lại khoá trong thông báo", async () => {
    const { xskHex } = await keys();
    const xsk = bech32.encode("acct_xsk", bech32.toWords(Buffer.from(xskHex, "hex")), 1000);
    for (const bad of [xsk, "xprv1abc", "root_xsk1qqq", xskHex]) {
      let msg = "";
      try { parseAccountKey(bad); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/bí mật/);
      if (bad.length > 30) expect(msg).not.toContain(bad.slice(10, 30));
    }
    const ok = toAcctXvk((await keys()).xvkHex);
    expect(() => parseAccountKey(ok.slice(0, -1) + (ok.endsWith("q") ? "p" : "q"))).toThrow(/checksum/);
    expect(() => parseAccountKey("abcd")).toThrow(/128/);
    expect(() => parseAccountKey("hello")).toThrow(/acct_xvk/);
  });
});

describe("AI-27 AC-002: dò địa chỉ theo gap 20", () => {
  it("địa chỉ #0 khớp ví mnemonic; dò qua khoảng trống < 20, dừng sau 20 địa chỉ trống liền", async () => {
    const { xvkHex } = await keys();
    const { deriveXpub } = await import("./xpub");
    const d = await deriveXpub(xvkHex, "preprod");
    expect(d.address(0, 0)).toBe((await deriveAccount(M.split(" "), "preprod")).baseAddress);
    const used = [d.address(0, 0), d.address(0, 3), d.address(0, 3 + GAP_LIMIT), d.address(1, 0)]; // #23 sits right at the gap edge
    const asked: string[] = [];
    const x = await scanXpub(xvkHex, "preprod", { accountAddresses: async (s) => (asked.push(s), used) });
    expect(asked).toEqual([d.stakeAddress]);
    expect(x.external).toEqual([d.address(0, 0), d.address(0, 3), d.address(0, 23)]);
    expect(x.internal).toEqual([d.address(1, 0)]);
    expect(x.receive).toBe(d.address(0, 1));
    const far = await scanXpub(xvkHex, "preprod", { accountAddresses: async () => [d.address(0, 0), d.address(0, 1 + GAP_LIMIT)] });
    expect(far.external).toEqual([d.address(0, 0)]); // 20 trống liền thì dừng
  });

  it("ví chỉ xem: số dư và lịch sử gộp từ mọi địa chỉ; không gửi, không ký, không có account thêm", async () => {
    const { xvkHex } = await keys();
    const { deriveXpub } = await import("./xpub");
    const d = await deriveXpub(xvkHex, "preprod");
    const A0 = d.address(0, 0), A5 = d.address(0, 5), C0 = d.address(1, 0);
    let balanceAsked: string[] = [];
    let listAsked: unknown;
    const providers: ProviderFactory = () => ({ fetcher: {} as never, submitter: {} as never, chain: {
      accountAddresses: async () => [A0, A5, C0],
      getBalance: async (as: string[]) => (balanceAsked = as, [{ unit: "lovelace", quantity: "7000000" }]),
      listAddressTxs: async (a: unknown) => (listAsked = a, [{ hash: "aa".repeat(32), blockTime: 5, blockHeight: 1 }]),
      getTxs: async () => [{ hash: "aa".repeat(32), blockTime: 5, blockHeight: 1, fee: "200000", inputs: [{ address: A0, lovelace: "3000000", assets: [] }], outputs: [{ address: "addr_test1other", lovelace: "1000000", assets: [] }, { address: C0, lovelace: "1800000", assets: [] }] }],
    } as never });
    const m = new WalletManager(new MemoryStore(), providers);
    await m.setupPassword("correct-horse");
    const w = await m.addWatchWallet("Xem", toAcctXvk(xvkHex));
    expect(w).toMatchObject({ kind: "watch", address: A0 });
    expect(JSON.stringify(w)).not.toMatch(/xsk/);
    await m.setActive(w.id, 0);
    expect(await m.getBalance()).toEqual([{ unit: "lovelace", quantity: "7000000" }]);
    expect(balanceAsked.sort()).toEqual([A0, A5, C0, d.address(0, 1)].sort());
    const page = await m.historyPage();
    expect(Array.isArray(listAsked)).toBe(true);
    expect(page.items[0]).toMatchObject({ direction: "out", netLovelace: -1_200_000n, feePaid: 200_000n }); // tiền thối về địa chỉ internal tính là của mình
    expect((await m.getHistory(3))[0]!.netLovelace).toBe(-1_200_000n);
    expect((await m.getAccount()).rewardAddress).toBe(d.stakeAddress);
    await expect(m.prepareSend({ to: A0, lovelace: 2_000_000n })).rejects.toThrow(/watch-only/);
    await expect(m.cip30()).rejects.toThrow(/watch-only/);
    await expect(m.addWatchWallet("Lại", xvkHex)).rejects.toThrow(/đã có/);
  });
});

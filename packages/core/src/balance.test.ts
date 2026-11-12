import { describe, it, expect } from "vitest";
import { WalletManager, MemoryStore, summarizeBalance, balanceFromUtxos, formatAda, decodeAssetName, parseUnit, serializeBalance, type ProviderFactory } from "./index";

const POLICY_A = "a".repeat(56);
const POLICY_B = "0b".repeat(28);
const HOSKY = "484f534b59"; // "HOSKY"
const NFT_BIN = "000de140ff"; // CIP-68 prefix + non-printable byte
const utxo = (i: number, amount: { unit: string; quantity: string }[]) => ({
  input: { txHash: String(i).padStart(64, "0"), outputIndex: 0 },
  output: { address: "addr_test1x", amount },
});

describe("AI-4: số dư ADA và native assets", () => {
  it("AC-001: ADA và hai loại token cộng đúng qua nhiều UTxO", () => {
    const utxos = [
      utxo(1, [{ unit: "lovelace", quantity: "1500000" }, { unit: POLICY_A + HOSKY, quantity: "100" }]),
      utxo(2, [{ unit: "lovelace", quantity: "2000001" }, { unit: POLICY_A + HOSKY, quantity: "23" }, { unit: POLICY_B + NFT_BIN, quantity: "1" }]),
    ];
    const b = summarizeBalance(balanceFromUtxos(utxos as never));
    expect(b.lovelace).toBe(3_500_001n);
    expect(b.ada).toBe("3.500001");
    expect(b.assets).toEqual([
      { unit: POLICY_B + NFT_BIN, policyId: POLICY_B, assetNameHex: NFT_BIN, assetName: undefined, quantity: 1n },
      { unit: POLICY_A + HOSKY, policyId: POLICY_A, assetNameHex: HOSKY, assetName: "HOSKY", quantity: 123n },
    ]);
  });

  it("AC-002: ví rỗng = 0 ADA, không có asset", () => {
    expect(summarizeBalance(balanceFromUtxos([]))).toEqual({ lovelace: 0n, ada: "0.000000", assets: [] });
  });

  it("AC-003: số lượng vượt 2^53 vẫn đúng", () => {
    const big = (2n ** 64n + 7n).toString();
    const utxos = [utxo(1, [{ unit: "lovelace", quantity: "9007199254740993" }, { unit: POLICY_A + HOSKY, quantity: big }]), utxo(2, [{ unit: POLICY_A + HOSKY, quantity: big }])];
    const b = summarizeBalance(balanceFromUtxos(utxos as never));
    expect(b.lovelace).toBe(9_007_199_254_740_993n);
    expect(b.ada).toBe("9007199254.740993");
    expect(b.assets[0]!.quantity).toBe(2n * (2n ** 64n + 7n));
    expect(serializeBalance(b).assets[0]!.quantity).toBe("36893488147419103246");
  });

  it("formatAda luôn 6 chữ số thập phân, không làm tròn", () => {
    expect(formatAda(0n)).toBe("0.000000");
    expect(formatAda(1n)).toBe("0.000001");
    expect(formatAda(1_000_000n)).toBe("1.000000");
    expect(formatAda("123456789")).toBe("123.456789");
    expect(formatAda(-2_500_000n)).toBe("-2.500000");
  });

  it("tên asset: hex luôn có; dạng đọc được chỉ khi là UTF-8 in được", () => {
    expect(decodeAssetName(HOSKY)).toBe("HOSKY");
    expect(decodeAssetName("e1baa1")).toBe("ạ");
    expect(decodeAssetName(NFT_BIN)).toBeUndefined();
    expect(decodeAssetName("ff")).toBeUndefined();
    expect(decodeAssetName("")).toBeUndefined();
    expect(parseUnit(POLICY_A)).toEqual({ policyId: POLICY_A, assetNameHex: "" });
    expect(() => parseUnit("xyz")).toThrow(/Unit/);
  });

  it("WalletManager.getWalletBalance đọc số dư địa chỉ ví qua ChainClient (fake, không cần mạng)", async () => {
    const seen: string[] = [];
    const providers: ProviderFactory = () => ({
      fetcher: {} as never,
      submitter: {} as never,
      chain: { getBalance: async (addrs: string[]) => { seen.push(...addrs); return [{ unit: "lovelace", quantity: "4200000" }, { unit: POLICY_A + HOSKY, quantity: "5" }]; } } as never,
    });
    const m = new WalletManager(new MemoryStore(), providers);
    await m.setupPassword("correct-horse");
    await m.addWallet("A", m.newMnemonic());
    const b = await m.getWalletBalance();
    expect(seen).toEqual([(await m.getAccount()).baseAddress]);
    expect(b.ada).toBe("4.200000");
    expect(b.assets.map((a) => [a.assetName, a.quantity])).toEqual([["HOSKY", 5n]]);
  });
});

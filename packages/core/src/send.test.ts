import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { Address, Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, minUtxoLovelace, assertPreprodAddress, prepareSend, type ProviderFactory } from "./index";

const PW = "correct-horse";
const A = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PARAMS = DEFAULT_PROTOCOL_PARAMETERS;
const POLICY = "c".repeat(56);
const HOSKY = POLICY + "484f534b59";
const MIN = POLICY + "4d494e";
const OTHER = "d".repeat(56) + "4e4654";

type Amount = { unit: string; quantity: string }[];
let utxoAmounts: Amount[] = [];
let params: typeof PARAMS | undefined = PARAMS;
let submitted: string[] = [];
const providers: ProviderFactory = () => ({
  fetcher: { fetchAddressUTxOs: async (address: string) => utxoAmounts.map((amount, i) => ({ input: { txHash: String(i + 1).padStart(64, "0"), outputIndex: i }, output: { address, amount } })) } as never,
  submitter: { submitTx: async (tx: string) => (submitted.push(tx), resolveTxHash(tx)) } as never,
  chain: { getProtocolParams: async () => { if (!params) throw new Error("down"); return params; } } as never,
});

let m: WalletManager;
let me = "";
let to = "";
beforeEach(async () => {
  utxoAmounts = [];
  params = PARAMS;
  submitted = [];
  m = new WalletManager(new MemoryStore(), providers);
  await m.setupPassword(PW);
  await m.addWallet("A", A);
  me = (await m.getAccount()).baseAddress;
  to = (await m.deriveFor(B)).baseAddress;
});

const ada = (n: number) => ({ unit: "lovelace", quantity: String(BigInt(Math.round(n * 1e6))) });
const tok = (unit: string, q: bigint | number) => ({ unit, quantity: String(q) });

/** Decode the built transaction and compute the balance independently of verifySendTx. */
function decode(txCbor: string) {
  const body = Serialization.Transaction.fromCbor(txCbor as never).body();
  const sum = (m: Map<string, bigint>, unit: string, q: bigint) => m.set(unit, (m.get(unit) ?? 0n) + q);
  const ins = new Map<string, bigint>();
  for (const i of body.inputs().values()) {
    const idx = Number(i.index());
    for (const a of utxoAmounts[idx]!) sum(ins, a.unit, BigInt(a.quantity));
  }
  const outs = new Map<string, bigint>([["lovelace", BigInt(body.fee())]]);
  const outputs = body.outputs().map((o) => {
    const v = o.amount();
    const assets = new Map<string, bigint>();
    for (const [id, q] of v.multiasset() ?? new Map()) { assets.set(String(id), BigInt(q)); sum(outs, String(id), BigInt(q)); }
    sum(outs, "lovelace", BigInt(v.coin()));
    return { address: o.address().toBech32(), coin: BigInt(v.coin()), assets, min: minUtxoLovelace(o.toCbor(), PARAMS.coinsPerUtxoSize) };
  });
  return { ins, outs, outputs, fee: BigInt(body.fee()) };
}

/** Mainnet address derived from a preprod one (flip the network nibble in the header), so no mainnet literal is committed. */
function toMainnet(testAddr: string) {
  const hex = Address.fromBech32(testAddr as never).toBytes() as string;
  const header = (parseInt(hex.slice(0, 2), 16) & 0xf0) | 0x01;
  return Address.fromBytes((header.toString(16).padStart(2, "0") + hex.slice(2)) as never).toBech32();
}

describe("AI-5: gửi ADA", () => {
  it("AC-001: giao dịch cân bằng (input = output + fee), output đạt min-UTxO, tiền thối về ví", async () => {
    utxoAmounts = [[ada(3)], [ada(4.5)], [ada(10), tok(HOSKY, 5)]];
    const p = await m.prepareSend({ to, lovelace: 5_000_000n });
    const pending = (m as any).pending.get(p.txHash);
    const d = decode(pending.unsignedTx);
    for (const [unit, q] of d.ins) expect(d.outs.get(unit)).toBe(q);
    for (const [unit, q] of d.outs) expect(d.ins.get(unit)).toBe(q);
    for (const o of d.outputs) expect(o.coin >= o.min).toBe(true);
    const recipient = d.outputs.find((o) => o.address === to)!;
    expect(recipient.coin).toBe(5_000_000n);
    expect(recipient.assets.size).toBe(0);
    expect(d.outputs.filter((o) => o.address !== to).every((o) => o.address === me)).toBe(true);
    // the preview matches the transaction
    expect(p).toMatchObject({ to, lovelace: 5_000_000n, fee: d.fee, totalLovelace: 5_000_000n + d.fee });
    expect(p.fee >= BigInt(PARAMS.minFeeB)).toBe(true);
  });

  it("người dùng xem trước rồi mới ký; chỉ ký đúng giao dịch đã xem", async () => {
    utxoAmounts = [[ada(20)]];
    const p = await m.prepareSend({ to, lovelace: 2_000_000n });
    expect(submitted).toHaveLength(0); // built, not signed, not submitted
    await expect(m.confirmSend("e".repeat(64), PW)).rejects.toMatchObject({ code: "INVALID_TX" });
    await expect(m.confirmSend(p.txHash, "sai-mat-khau")).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    expect(submitted).toHaveLength(0);
    expect(await m.confirmSend(p.txHash, PW)).toBe(p.txHash);
    expect(submitted).toHaveLength(1);
    expect(resolveTxHash(submitted[0]!)).toBe(p.txHash);
    await expect(m.confirmSend(p.txHash, PW)).rejects.toMatchObject({ code: "INVALID_TX" }); // cannot be submitted twice
  });

  it("AC-002: địa chỉ mainnet hoặc sai định dạng bị từ chối", async () => {
    utxoAmounts = [[ada(20)]];
    const mainnet = toMainnet(to);
    expect(mainnet.startsWith("addr1")).toBe(true);
    for (const bad of [mainnet, "addr_test1qqqq", "hello", ` ${to}`, to.slice(0, -1) + (to.endsWith("q") ? "p" : "q"), (await m.getAccount()).rewardAddress])
      await expect(m.prepareSend({ to: bad, lovelace: 2_000_000n })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    expect(() => assertPreprodAddress(to)).not.toThrow();
  });

  it("AC-003: không đủ tiền kể cả phí thì báo lỗi, không ký, không gửi", async () => {
    utxoAmounts = [[ada(3)]];
    await expect(m.prepareSend({ to, lovelace: 3_000_000n })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); // covers the amount but not the fee
    await expect(m.prepareSend({ to, lovelace: 50_000_000n })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((m as any).pending.size).toBe(0);
    expect(submitted).toHaveLength(0);
  });

  it("số tiền dưới min-UTxO hoặc <= 0 bị từ chối; thiếu protocol parameters thì không dựng", async () => {
    utxoAmounts = [[ada(20)]];
    await expect(m.prepareSend({ to, lovelace: 10n })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(m.prepareSend({ to, lovelace: 0n })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    params = undefined;
    await expect(m.prepareSend({ to, lovelace: 2_000_000n })).rejects.toMatchObject({ code: "NO_PARAMS" });
  });
});


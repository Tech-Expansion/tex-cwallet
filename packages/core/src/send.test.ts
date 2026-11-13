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

describe("AI-6: gửi native token", () => {
  it("AC-001: gửi một phần token: người nhận đúng lượng + ADA tối thiểu, phần còn lại và token khác về ví", async () => {
    utxoAmounts = [[ada(5), tok(HOSKY, 100), tok(OTHER, 1)], [ada(8)]];
    const p = await m.prepareSend({ to, assets: [{ unit: HOSKY, quantity: 30n }] });
    const d = decode((m as any).pending.get(p.txHash).unsignedTx);
    const r = d.outputs.find((o) => o.address === to)!;
    expect([...r.assets]).toEqual([[HOSKY, 30n]]);
    expect(r.coin).toBe(r.min); // exactly the required minimum ADA
    expect(p.lovelace).toBe(r.min);
    expect(p.minLovelace).toBe(r.min);
    const back = new Map<string, bigint>();
    for (const o of d.outputs.filter((o) => o.address === me)) for (const [u, q] of o.assets) back.set(u, (back.get(u) ?? 0n) + q);
    expect(back.get(HOSKY)).toBe(70n);
    expect(back.get(OTHER)).toBe(1n); // no token is lost
    for (const [unit, q] of d.ins) expect(d.outs.get(unit)).toBe(q);
    expect(p.change.assets).toEqual(expect.arrayContaining([{ unit: HOSKY, quantity: 70n }, { unit: OTHER, quantity: 1n }]));
  });

  it("AC-002: hai loại token trong cùng một giao dịch (kèm ADA tự chọn)", async () => {
    utxoAmounts = [[ada(4), tok(HOSKY, 10)], [ada(4), tok(MIN, 7)], [ada(6)]];
    const p = await m.prepareSend({ to, lovelace: 3_000_000n, assets: [{ unit: HOSKY, quantity: 10n }, { unit: MIN, quantity: 2n }] });
    const d = decode((m as any).pending.get(p.txHash).unsignedTx);
    const r = d.outputs.find((o) => o.address === to)!;
    expect(r.coin).toBe(3_000_000n);
    expect(Object.fromEntries(r.assets)).toEqual({ [HOSKY]: 10n, [MIN]: 2n });
    for (const [unit, q] of d.ins) expect(d.outs.get(unit)).toBe(q);
    expect(await m.confirmSend(p.txHash, PW)).toBe(p.txHash);
  });

  it("AC-003: không đủ token thì báo lỗi, không dựng / ký", async () => {
    utxoAmounts = [[ada(10), tok(HOSKY, 5)]];
    await expect(m.prepareSend({ to, assets: [{ unit: HOSKY, quantity: 6n }] })).rejects.toMatchObject({ code: "INSUFFICIENT_TOKENS" });
    await expect(m.prepareSend({ to, assets: [{ unit: MIN, quantity: 1n }] })).rejects.toMatchObject({ code: "INSUFFICIENT_TOKENS" });
    await expect(m.prepareSend({ to, assets: [{ unit: HOSKY, quantity: 0n }] })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(m.prepareSend({ to, assets: [{ unit: "xyz", quantity: 1n }] })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect((m as any).pending.size).toBe(0);
    expect(submitted).toHaveLength(0);
  });

  it("verifySendTx chặn giao dịch bị sửa (đổi người nhận / số lượng)", async () => {
    utxoAmounts = [[ada(20), tok(HOSKY, 50)]];
    const prepared = await prepareSend({ req: { to, assets: [{ unit: HOSKY, quantity: 5n }] }, utxos: (await providers("preprod", {}).fetcher.fetchAddressUTxOs(me)) as never, changeAddress: me, params: PARAMS });
    const { verifySendTx } = await import("./send");
    const exp = { to, lovelace: prepared.preview.lovelace, assets: prepared.preview.assets, changeAddress: me };
    expect(() => verifySendTx(prepared.unsignedTx, prepared.utxos, PARAMS, exp)).not.toThrow();
    expect(() => verifySendTx(prepared.unsignedTx, prepared.utxos, PARAMS, { ...exp, assets: [{ unit: HOSKY, quantity: 6n }] })).toThrow(/Token/);
    expect(() => verifySendTx(prepared.unsignedTx, prepared.utxos, PARAMS, { ...exp, to: me, changeAddress: to })).toThrow();
    expect(() => verifySendTx(prepared.unsignedTx, [], PARAMS, exp)).toThrow(/input/);
  });
});

describe("AI-23: gửi nâng cao", () => {
  const C = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
  let to2 = "";
  beforeEach(async () => { to2 = (await m.deriveFor(C)).baseAddress; });
  const balanced = (d: ReturnType<typeof decode>) => { for (const [u, q] of d.ins) expect(d.outs.get(u)).toBe(q); for (const [u, q] of d.outs) expect(d.ins.get(u)).toBe(q); };

  it("AC-001/004: nhiều người nhận (ADA + token) theo đúng thứ tự, mỗi output đạt min-UTxO, xem trước liệt kê từng người", async () => {
    utxoAmounts = [[ada(10), tok(HOSKY, 40)], [ada(15)]];
    const p = await m.prepareSend({ outputs: [{ to, lovelace: 3_000_000n }, { to: to2, assets: [{ unit: HOSKY, quantity: 15n }] }] });
    const d = decode((m as any).pending.get(p.txHash).unsignedTx);
    balanced(d);
    for (const o of d.outputs) expect(o.coin >= o.min).toBe(true);
    expect(d.outputs[0]!.address).toBe(to);
    expect(d.outputs[0]!.coin).toBe(3_000_000n);
    expect(d.outputs[1]!.address).toBe(to2);
    expect([...d.outputs[1]!.assets]).toEqual([[HOSKY, 15n]]);
    expect(p.recipients.map((r) => [r.to, r.lovelace])).toEqual([[to, 3_000_000n], [to2, d.outputs[1]!.coin]]);
    expect(p.recipients[1]!.lovelace).toBe(p.recipients[1]!.minLovelace);
    expect(p.totalLovelace).toBe(3_000_000n + d.outputs[1]!.coin + p.fee);
    expect(p.change.assets).toEqual([{ unit: HOSKY, quantity: 25n }]);
    expect(await m.confirmSend(p.txHash, PW)).toBe(p.txHash);
  });

  it("AC-001: từng người nhận được kiểm tra; lỗi chỉ rõ người nào", async () => {
    utxoAmounts = [[ada(30)]];
    await expect(m.prepareSend({ outputs: [{ to, lovelace: 2_000_000n }, { to: to2, lovelace: 5n }] })).rejects.toThrow(/#2/);
    await expect(m.prepareSend({ outputs: [{ to, lovelace: 2_000_000n }, { to: toMainnet(to2), lovelace: 2_000_000n }] })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.prepareSend({ outputs: [] })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.prepareSend({ outputs: Array.from({ length: 21 }, () => ({ to, lovelace: 1_000_000n })) })).rejects.toThrow(/Tối đa 20/);
    await expect(m.prepareSend({ outputs: [{ to, lovelace: 15_000_000n }, { to: to2, lovelace: 15_000_000n }] })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("verifySendTx chặn đổi thứ tự / thiếu người nhận", async () => {
    utxoAmounts = [[ada(20)]];
    const utxos = (await providers("preprod", {}).fetcher.fetchAddressUTxOs(me)) as never;
    const prepared = await prepareSend({ req: { outputs: [{ to, lovelace: 2_000_000n }, { to: to2, lovelace: 3_000_000n }] }, utxos, changeAddress: me, params: PARAMS });
    const { verifySendTx } = await import("./send");
    const ok = { outputs: [{ to, lovelace: 2_000_000n, assets: [] }, { to: to2, lovelace: 3_000_000n, assets: [] }], changeAddress: me };
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, ok)).not.toThrow();
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, { ...ok, outputs: [ok.outputs[1]!, ok.outputs[0]!] })).toThrow();
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, { ...ok, outputs: [...ok.outputs, { to, lovelace: 1n, assets: [] }] })).toThrow(/đủ output/);
  });

  it("AC-002: gửi tối đa (chỉ ADA): tiêu mọi UTxO, không có tiền thối, người nhận = tổng − phí", async () => {
    utxoAmounts = [[ada(3)], [ada(4.5)], [ada(10)]];
    const p = await m.prepareSend({ to, max: true });
    const d = decode((m as any).pending.get(p.txHash).unsignedTx);
    balanced(d);
    expect(d.ins.get("lovelace")).toBe(17_500_000n);
    expect(d.outputs).toHaveLength(1);
    expect(d.outputs[0]!.address).toBe(to);
    expect(p).toMatchObject({ max: true, lovelace: 17_500_000n - p.fee, totalLovelace: 17_500_000n, change: { lovelace: 0n, assets: [] } });
    expect(await m.confirmSend(p.txHash, PW)).toBe(p.txHash);
  });

  it("AC-002: gửi tối đa giữ token chưa chọn trong một output đúng min-UTxO; token đã chọn đi theo", async () => {
    utxoAmounts = [[ada(5), tok(HOSKY, 9), tok(OTHER, 1)], [ada(6), tok(MIN, 4)]];
    const p = await m.prepareSend({ to, max: true, assets: [{ unit: HOSKY, quantity: 9n }] });
    const d = decode((m as any).pending.get(p.txHash).unsignedTx);
    balanced(d);
    const mine = d.outputs.filter((o) => o.address === me);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.coin).toBe(mine[0]!.min); // no change below or above min-UTxO
    expect(Object.fromEntries(mine[0]!.assets)).toEqual({ [MIN]: 4n, [OTHER]: 1n });
    const r = d.outputs.find((o) => o.address === to)!;
    expect([...r.assets]).toEqual([[HOSKY, 9n]]);
    expect(r.coin).toBe(11_000_000n - mine[0]!.coin - d.fee);
  });

  it("AC-002: gửi tối đa từ chối nhiều người nhận, số ADA cụ thể, gửi về chính ví, không đủ trả phí", async () => {
    utxoAmounts = [[ada(5)]];
    await expect(m.prepareSend({ outputs: [{ to }, { to: to2 }], max: true })).rejects.toThrow(/một người nhận/);
    await expect(m.prepareSend({ to, lovelace: 2_000_000n, max: true })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(m.prepareSend({ to: me, max: true })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    utxoAmounts = [[ada(0.9)]];
    await expect(m.prepareSend({ to, max: true })).rejects.toBeTruthy();
  });

  it("AC-003: memo CIP-20 (nhãn 674) chia dòng ≤ 64 byte, không cắt giữa ký tự UTF-8; xem trước có memo", async () => {
    const { memoLines, txMemo } = await import("./send");
    const long = "Tiền học tháng 11 — ".repeat(6);
    const lines = memoLines(`Xin chào\n${long}`)!;
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(64);
    expect(lines.join("")).toBe(`Xin chào${long.trim()}`);
    expect(memoLines("   ")).toBeUndefined();
    expect(() => memoLines("x".repeat(64 * 17))).toThrow(/quá dài/);
    utxoAmounts = [[ada(20)]];
    const p = await m.prepareSend({ to, lovelace: 2_000_000n, memo: "Trả tiền cà phê ☕" });
    expect(p.memo).toEqual(["Trả tiền cà phê ☕"]);
    const tx = (m as any).pending.get(p.txHash).unsignedTx;
    expect(txMemo(tx)).toEqual(["Trả tiền cà phê ☕"]);
    expect(await m.confirmSend(p.txHash, PW)).toBe(p.txHash);
    expect(txMemo(submitted[0]!)).toEqual(["Trả tiền cà phê ☕"]);
  });

  it("AC-003: verifySendTx từ chối memo bị đổi hoặc metadata không yêu cầu", async () => {
    utxoAmounts = [[ada(20)]];
    const utxos = (await providers("preprod", {}).fetcher.fetchAddressUTxOs(me)) as never;
    const prepared = await prepareSend({ req: { to, lovelace: 2_000_000n, memo: "a" }, utxos, changeAddress: me, params: PARAMS });
    const { verifySendTx } = await import("./send");
    const base = { outputs: [{ to, lovelace: 2_000_000n, assets: [] }], changeAddress: me };
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, { ...base, memo: ["a"] })).not.toThrow();
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, { ...base, memo: ["b"] })).toThrow(/Ghi chú/);
    expect(() => verifySendTx(prepared.unsignedTx, utxos, PARAMS, base)).toThrow(/Ghi chú/);
  });
});

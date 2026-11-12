import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, COLLATERAL_LOVELACE, type ProviderFactory } from "./index";

const PW = "correct-horse";
const A = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B = "legal winner thank year wave sausage worth useful legal winner thank yellow";
type U = { input: { txHash: string; outputIndex: number }; output: { address: string; amount: { unit: string; quantity: string }[] } };
let utxos: U[] = [];
let submitted: string[] = [];
const providers: ProviderFactory = () => ({
  fetcher: { fetchAddressUTxOs: async () => structuredClone(utxos) } as never,
  submitter: { submitTx: async (tx: string) => (submitted.push(tx), resolveTxHash(tx)) } as never,
  chain: { getProtocolParams: async () => DEFAULT_PROTOCOL_PARAMETERS } as never,
});
const h = (n: number) => n.toString(16).padStart(64, "0");
const ada = (n: number) => [{ unit: "lovelace", quantity: String(BigInt(Math.round(n * 1e6))) }];

let m: WalletManager, me: string, to: string;
beforeEach(async () => {
  submitted = [];
  m = new WalletManager(new MemoryStore(), providers);
  await m.setupPassword(PW);
  await m.addWallet("A", A);
  me = (await m.getAccount()).baseAddress;
  to = (await m.deriveFor(B)).baseAddress;
  utxos = [{ input: { txHash: h(1), outputIndex: 0 }, output: { address: me, amount: ada(20) } }];
});

/** Simulate the chain: the collateral transaction lands, its outputs become UTxOs. */
function land(tx: string) {
  const hash = resolveTxHash(tx);
  const outs = Serialization.Transaction.fromCbor(tx as never).body().outputs();
  utxos = outs.map((o, i) => ({ input: { txHash: hash, outputIndex: i }, output: { address: o.address().toBech32(), amount: [{ unit: "lovelace", quantity: String(o.amount().coin()) }] } }));
}

describe("AI-25: collateral", () => {
  it("AC-001: xem trước giao dịch 5 ADA gửi chính mình, ký xong thì ghi nhận output #0", async () => {
    expect(await m.collateralStatus()).toEqual({ state: "none" });
    const p = await m.prepareCollateral();
    expect(p.recipients).toEqual([expect.objectContaining({ to: me, lovelace: COLLATERAL_LOVELACE })]);
    expect(submitted).toHaveLength(0);
    const hash = await m.confirmSend(p.txHash, PW);
    expect(await m.collateralStatus()).toEqual({ state: "pending", txHash: hash });
    land(submitted[0]!);
    expect(await m.collateralStatus()).toEqual({ state: "ready", txHash: hash, outputIndex: 0, lovelace: COLLATERAL_LOVELACE });
    await expect(m.prepareCollateral()).rejects.toThrow(/đã có collateral/);
  });

  it("AC-002: CIP-30 getCollateral trả đúng UTxO chỉ ADA; chưa có = null; > 5 ADA bị từ chối", async () => {
    const api = await m.cip30();
    expect(await api.getCollateral()).toBeNull();
    const p = await m.prepareCollateral();
    await m.confirmSend(p.txHash, PW);
    land(submitted[0]!);
    const [cbor] = (await api.getCollateral())!;
    const u = Serialization.TransactionUnspentOutput.fromCbor(cbor as never);
    expect(u.input().transactionId()).toBe(resolveTxHash(submitted[0]!));
    expect(BigInt(u.output().amount().coin())).toBe(COLLATERAL_LOVELACE);
    expect(u.output().amount().multiasset()).toBeUndefined();
    const coin = (n: bigint) => new Serialization.Value(n).toCbor();
    expect(await api.getCollateral({ amount: coin(2_000_000n) })).toHaveLength(1);
    await expect(api.getCollateral({ amount: coin(6_000_000n) })).rejects.toThrow(/5 ADA/);
  });

  it("AC-003: gửi thường (kể cả gửi tối đa) không tiêu collateral; tắt bảo vệ thì được tiêu", async () => {
    const p = await m.prepareCollateral();
    await m.confirmSend(p.txHash, PW);
    land(submitted[0]!);
    const col = resolveTxHash(submitted[0]!);
    const inputsOf = async (txHash: string) => [...Serialization.Transaction.fromCbor((m as any).pending.get(txHash).unsignedTx).body().inputs().values()].map((i) => `${i.transactionId()}#${i.index()}`);
    const max = await m.prepareSend({ to, max: true });
    expect(await inputsOf(max.txHash)).not.toContain(`${col}#0`);
    expect(max.totalLovelace).toBe(BigInt(utxos[1]!.output.amount[0]!.quantity));
    await expect(m.prepareSend({ to, lovelace: 14_800_000n })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); // would need the collateral
    await m.setCollateralProtected(false);
    const all = await m.prepareSend({ to, max: true });
    expect(await inputsOf(all.txHash)).toContain(`${col}#0`);
    await m.removeCollateral();
    expect(await m.collateralStatus()).toEqual({ state: "none" });
  });

  it("collateral theo từng tài khoản; UTxO bị tiêu thì về trạng thái chờ", async () => {
    const p = await m.prepareCollateral();
    await m.confirmSend(p.txHash, PW);
    land(submitted[0]!);
    const w = m.listWallets()[0]!;
    await m.addAccount(w.id);
    await m.setActive(w.id, 1);
    expect(await m.collateralStatus()).toEqual({ state: "none" });
    await m.setActive(w.id, 0);
    utxos = [];
    expect((await m.collateralStatus()).state).toBe("pending");
  });
});

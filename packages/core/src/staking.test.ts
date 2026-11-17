import { describe, it, expect, beforeEach } from "vitest";
import { bech32 } from "bech32";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { Serialization, resolveTxHash, Ed25519PublicKey, Ed25519Signature } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, verifyStakeTx, prepareStake, KoiosClient, isPoolId, type ProviderFactory, type StakeAccount } from "./index";

const PW = "correct-horse";
const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const pool = (b: number) => bech32.encode("pool", bech32.toWords(Buffer.alloc(28, b)));
const P1 = pool(1), P2 = pool(2);
const PARAMS = DEFAULT_PROTOCOL_PARAMETERS;
let account: StakeAccount;
let submitted: string[] = [];
const providers: ProviderFactory = () => ({
  fetcher: { fetchAddressUTxOs: async (address: string) => [{ input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: "20000000" }] } }] } as never,
  submitter: { submitTx: async (tx: string) => (submitted.push(tx), resolveTxHash(tx)) } as never,
  chain: { getProtocolParams: async () => PARAMS, getStakeAccount: async () => account, searchPools: async (q: string) => (q === P1 ? [{ poolId: P1, ticker: "ONE", margin: 0.01, fixedCost: 340000000n, pledge: 1n, liveStake: 5n, saturation: 12.5 }] : []) } as never,
});

let m: WalletManager;
beforeEach(async () => {
  account = { registered: false, rewards: 0n };
  submitted = [];
  m = new WalletManager(new MemoryStore(), providers);
  await m.setupPassword(PW);
  await m.addWallet("A", M);
});
const decode = (tx: string) => Serialization.Transaction.fromCbor(tx as never);

describe("AI-28: staking", () => {
  it("AC-002: chưa đăng ký → đăng ký + delegate, cọc 2 ADA ghi rõ, cân bằng; ký bằng cả payment và stake key", async () => {
    const p = await m.prepareStake({ kind: "delegate", poolId: P1 });
    expect(p).toMatchObject({ action: "delegate", certs: ["reg", "deleg"], poolId: P1, deposit: BigInt(PARAMS.keyDeposit), refund: 0n, withdrawal: 0n });
    expect(p.change).toBe(20_000_000n - p.fee - BigInt(PARAMS.keyDeposit));
    await m.confirmSend(p.txHash, PW);
    const tx = decode(submitted[0]!);
    const vkeys = [...tx.witnessSet().vkeys()!.values()];
    expect(vkeys).toHaveLength(2);
    for (const v of vkeys) expect(Ed25519PublicKey.fromHex(v.vkey()).verify(Ed25519Signature.fromHex(v.signature()), resolveTxHash(submitted[0]!) as never)).toBe(true);
    const stakeHash = (tx.body().certs()!.values()[0]!.toCore() as any).stakeCredential.hash;
    expect(vkeys.some((v) => Ed25519PublicKey.fromHex(v.vkey()).hash().hex() === stakeHash)).toBe(true);
  });

  it("đã đăng ký: chỉ delegate, không cọc; cùng pool thì từ chối", async () => {
    account = { registered: true, poolId: P2, rewards: 0n };
    const p = await m.prepareStake({ kind: "delegate", poolId: P1 });
    expect(p).toMatchObject({ certs: ["deleg"], deposit: 0n });
    account.poolId = P1;
    await expect(m.prepareStake({ kind: "delegate", poolId: P1 })).rejects.toThrow(/rồi/);
    await expect(m.prepareStake({ kind: "delegate", poolId: "pool1xyz" })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });

  it("AC-004: rút thưởng đúng số và đúng reward address; huỷ đăng ký rút hết + hoàn cọc", async () => {
    account = { registered: true, poolId: P1, rewards: 3_456_789n };
    const w = await m.prepareStake({ kind: "withdraw" });
    expect(w).toMatchObject({ certs: [], withdrawal: 3_456_789n, deposit: 0n, refund: 0n });
    expect(w.change).toBe(20_000_000n + 3_456_789n - w.fee);
    const wd = [...decode((m as any).pending.get(w.txHash).unsignedTx).body().withdrawals()!];
    expect(String(wd[0]![0])).toBe((await m.getAccount()).rewardAddress);
    const d = await m.prepareStake({ kind: "deregister" });
    expect(d).toMatchObject({ certs: ["dereg"], withdrawal: 3_456_789n, refund: BigInt(PARAMS.keyDeposit) });
    expect(d.change).toBe(20_000_000n + 3_456_789n + BigInt(PARAMS.keyDeposit) - d.fee);
    await m.confirmSend(d.txHash, PW);
    expect(submitted).toHaveLength(1);
    account = { registered: true, rewards: 0n };
    await expect(m.prepareStake({ kind: "withdraw" })).rejects.toThrow(/phần thưởng/);
    account = { registered: false, rewards: 0n };
    await expect(m.prepareStake({ kind: "deregister" })).rejects.toThrow(/chưa đăng ký/);
  });

  it("AC-001: verifyStakeTx từ chối sai loại certificate, sai pool, stake key khác, rút thưởng lạ", async () => {
    const acc = await m.getAccount();
    const utxos = [{ input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address: acc.baseAddress, amount: [{ unit: "lovelace", quantity: "20000000" }] } }];
    const stakeKeyHash = (await (m as any).stakeKey()).toPublic().hash().hex();
    const base = { changeAddress: acc.baseAddress, rewardAddress: acc.rewardAddress, stakeKeyHash };
    const b = await prepareStake({ action: { kind: "delegate", poolId: P1 }, account: { registered: false, rewards: 0n }, utxos, params: PARAMS, ...base });
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, b.expect)).not.toThrow();
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, { ...b.expect, certs: ["deleg"] })).toThrow(/đúng thao tác/);
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, { ...b.expect, poolId: P2 })).toThrow(/Pool/);
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, { ...b.expect, stakeKeyHash: "00".repeat(28) })).toThrow(/stake key/);
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, { ...b.expect, withdrawal: 1n })).toThrow(/Rút thưởng/);
    const other = (await m.deriveFor("legal winner thank year wave sausage worth useful legal winner thank yellow")).baseAddress;
    expect(() => verifyStakeTx(b.unsignedTx, utxos, PARAMS, { ...b.expect, changeAddress: other })).toThrow(/địa chỉ lạ/);
    const w = await prepareStake({ action: { kind: "withdraw" }, account: { registered: true, rewards: 5n }, utxos, params: PARAMS, ...base });
    expect(() => verifyStakeTx(w.unsignedTx, utxos, PARAMS, { ...w.expect, withdrawal: undefined })).toThrow(/không mong muốn/);
    expect(() => verifyStakeTx(w.unsignedTx, utxos, PARAMS, { ...w.expect, rewardAddress: "stake_test1other" })).toThrow(/sai địa chỉ/);
  });

  it("stakeInfo kèm pool; ví watch-only không dựng/ký được", async () => {
    account = { registered: true, poolId: P1, rewards: 7n };
    expect(await m.stakeInfo()).toMatchObject({ registered: true, rewards: 7n, pool: { ticker: "ONE" }, stakeAddress: (await m.getAccount()).rewardAddress });
    const w = await m.addWatchWallet("X", (await m.getAccount()).baseAddress);
    await m.setActive(w.id, 0);
    await expect(m.prepareStake({ kind: "delegate", poolId: P1 })).rejects.toThrow(/watch-only/);
  });
});

describe("AI-28 AC-003: dữ liệu pool", () => {
  const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
  it("Koios: account_info, tìm theo ticker (pool_list → pool_info) hoặc pool id; chặn ký tự lạ", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (u.includes("/account_info")) return j([{ status: "registered", delegated_pool: P1, rewards_available: "123" }]);
      if (u.includes("/pool_list")) return j([{ pool_id_bech32: P1 }]);
      return j([{ pool_id_bech32: P1, meta_json: { ticker: "ONE", name: "One" }, margin: 0.02, fixed_cost: "340000000", pledge: "1000", live_stake: "99", live_saturation: 41.7, pool_status: "registered" }]);
    }) as never;
    const k = new KoiosClient("preprod", f, "https://k/api/v1");
    expect(await k.getStakeAccount("stake_test1x")).toEqual({ registered: true, poolId: P1, rewards: 123n });
    expect(await k.searchPools("one")).toEqual([{ poolId: P1, ticker: "ONE", name: "One", margin: 0.02, fixedCost: 340000000n, pledge: 1000n, liveStake: 99n, saturation: 41.7, retiring: false }]);
    expect(urls.some((u) => u.includes("ticker=ilike.*one*"))).toBe(true);
    expect(await k.searchPools("a&b=c")).toEqual([]);
    expect(isPoolId(P1)).toBe(true);
  });
});

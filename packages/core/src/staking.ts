/**
 * Staking (AI-28): register the stake key, delegate to a pool, withdraw rewards, deregister.
 * Every transaction is built unsigned, checked by verifyStakeTx and previewed before signing.
 */
import { MeshTxBuilder } from "@meshsdk/core";
import type { Protocol, UTxO } from "@meshsdk/core";
import { Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { WalletError } from "./errors";
import { minFeeFor, minUtxoLovelace } from "./send";

export interface StakeAccount {
  registered: boolean;
  /** bech32 pool id the stake key delegates to */
  poolId?: string;
  /** Rewards that can be withdrawn now (lovelace) */
  rewards: bigint;
}

export interface PoolInfo {
  poolId: string;
  ticker?: string;
  name?: string;
  /** 0..1 */
  margin: number;
  fixedCost: bigint;
  pledge: bigint;
  liveStake: bigint;
  /** percent of the saturation point, e.g. 63.2 */
  saturation?: number;
  retiring?: boolean;
}

export interface StakeSource {
  getStakeAccount(stakeAddress: string): Promise<StakeAccount>;
  /** pool1… id, or a ticker / name fragment */
  searchPools(query: string): Promise<PoolInfo[]>;
}

export type StakeAction = { kind: "delegate"; poolId: string } | { kind: "withdraw" } | { kind: "deregister" };
type CertKind = "reg" | "deleg" | "dereg";

export interface StakeExpectation {
  changeAddress: string;
  rewardAddress: string;
  stakeKeyHash: string;
  certs: CertKind[];
  poolId?: string;
  /** exact withdrawal from our reward address; undefined = none allowed */
  withdrawal?: bigint;
}

export interface StakePreview {
  txHash: string;
  action: StakeAction["kind"];
  certs: CertKind[];
  poolId?: string;
  fee: bigint;
  /** stake key deposit paid now (registration) */
  deposit: bigint;
  /** deposit returned now (deregistration) */
  refund: bigint;
  withdrawal: bigint;
  /** ADA back to the wallet in this transaction */
  change: bigint;
}

const POOL_ID = /^pool1[02-9ac-hj-np-z]{51}$/;
export const isPoolId = (s: string) => POOL_ID.test(s.trim());

const ref = (h: string, i: number | bigint) => `${h}#${Number(i)}`;

/**
 * Check a staking transaction before signing (AC-001): wallet inputs only, every output to our change
 * address, exactly the certificates chosen (our stake key, the chosen pool), a withdrawal only from our
 * reward address and only of the expected amount, value balanced with deposit/refund, no metadata or mint.
 */
export function verifyStakeTx(txCbor: string, utxos: UTxO[], params: Protocol, e: StakeExpectation): Omit<StakePreview, "txHash" | "action"> {
  const tx = Serialization.Transaction.fromCbor(txCbor as never);
  const body = tx.body();
  const aux = tx.auxiliaryData();
  const auxUsed = !!aux && ((aux.metadata()?.metadata()?.size ?? 0) > 0 || !!aux.nativeScripts()?.length || !!aux.plutusV1Scripts()?.length);
  if (body.mint() || body.collateral() || body.referenceInputs() || auxUsed) throw new WalletError("INVALID_TX", "Giao dịch staking chứa thành phần không mong muốn");
  const byRef = new Map(utxos.map((u) => [ref(u.input.txHash, u.input.outputIndex), u]));
  let inLovelace = 0n;
  const inAssets = new Map<string, bigint>();
  for (const i of body.inputs().values()) {
    const u = byRef.get(ref(i.transactionId(), i.index()));
    if (!u) throw new WalletError("INVALID_TX", "Giao dịch dùng input không thuộc ví");
    for (const a of u.output.amount) {
      if (a.unit === "lovelace" || a.unit === "") inLovelace += BigInt(a.quantity);
      else inAssets.set(a.unit, (inAssets.get(a.unit) ?? 0n) + BigInt(a.quantity));
    }
  }
  let outLovelace = 0n;
  const outAssets = new Map<string, bigint>();
  body.outputs().forEach((o, idx) => {
    if (o.address().toBech32() !== e.changeAddress) throw new WalletError("INVALID_TX", "Giao dịch staking có output tới địa chỉ lạ");
    if (BigInt(o.amount().coin()) < minUtxoLovelace(o.toCbor(), params.coinsPerUtxoSize)) throw new WalletError("INVALID_TX", `Output #${idx + 1} dưới min-UTxO`);
    outLovelace += BigInt(o.amount().coin());
    for (const [id, q] of o.amount().multiasset() ?? new Map()) outAssets.set(String(id), (outAssets.get(String(id)) ?? 0n) + BigInt(q));
  });
  for (const u of new Set([...inAssets.keys(), ...outAssets.keys()])) if ((inAssets.get(u) ?? 0n) !== (outAssets.get(u) ?? 0n)) throw new WalletError("INVALID_TX", "Token không được bảo toàn");

  const certs = [...(body.certs()?.values() ?? [])].map((c) => c.toCore() as { __typename: string; stakeCredential?: { hash: string; type: number }; poolId?: string; deposit?: bigint });
  const kinds: CertKind[] = certs.map((c) => {
    const k = /^(StakeRegistration|Registration)Certificate$/.test(c.__typename) ? "reg" : c.__typename === "StakeDelegationCertificate" ? "deleg" : /^(StakeDeregistration|Unregistration)Certificate$/.test(c.__typename) ? "dereg" : undefined;
    if (!k) throw new WalletError("INVALID_TX", `Certificate không được phép: ${c.__typename}`);
    if (c.stakeCredential?.type !== 0 || c.stakeCredential.hash !== e.stakeKeyHash) throw new WalletError("INVALID_TX", "Certificate không thuộc stake key của ví");
    if (k === "deleg" && c.poolId !== e.poolId) throw new WalletError("INVALID_TX", "Pool trong giao dịch khác pool đã chọn");
    return k;
  });
  if (JSON.stringify(kinds) !== JSON.stringify(e.certs)) throw new WalletError("INVALID_TX", "Certificate không đúng thao tác đã chọn");

  const wd = [...(body.withdrawals() ?? new Map())];
  let withdrawal = 0n;
  if (e.withdrawal === undefined) {
    if (wd.length) throw new WalletError("INVALID_TX", "Giao dịch rút thưởng không mong muốn");
  } else {
    if (wd.length !== 1 || String(wd[0]![0]) !== e.rewardAddress || BigInt(wd[0]![1]) !== e.withdrawal) throw new WalletError("INVALID_TX", "Rút thưởng sai địa chỉ hoặc số tiền");
    withdrawal = e.withdrawal;
  }
  const keyDeposit = BigInt(params.keyDeposit);
  const deposit = kinds.includes("reg") ? keyDeposit : 0n;
  const refund = kinds.includes("dereg") ? keyDeposit : 0n;
  const fee = BigInt(body.fee());
  if (inLovelace + withdrawal + refund !== outLovelace + fee + deposit) throw new WalletError("INVALID_TX", "Giao dịch staking không cân bằng");
  if (fee < minFeeFor(txCbor, params)) throw new WalletError("INVALID_TX", "Phí thấp hơn mức tối thiểu");
  return { certs: kinds, poolId: e.poolId, fee, deposit, refund, withdrawal, change: outLovelace };
}

/** Build an unsigned staking transaction for one action. */
export async function prepareStake(p: {
  action: StakeAction; account: StakeAccount; utxos: UTxO[]; params: Protocol | undefined;
  changeAddress: string; rewardAddress: string; stakeKeyHash: string;
}): Promise<{ unsignedTx: string; expect: StakeExpectation; preview: StakePreview }> {
  const { action, account, utxos, changeAddress, rewardAddress } = p;
  if (!p.params) throw new WalletError("NO_PARAMS", "Không lấy được protocol parameters của preprod; không thể tính phí");
  const params = p.params;
  const b = new MeshTxBuilder({ params });
  const expect: StakeExpectation = { changeAddress, rewardAddress, stakeKeyHash: p.stakeKeyHash, certs: [] };
  if (action.kind === "delegate") {
    if (!isPoolId(action.poolId)) throw new WalletError("INVALID_ADDRESS", "Pool id phải dạng pool1…");
    if (account.registered && account.poolId === action.poolId) throw new WalletError("INVALID_TX", "Đang delegate cho pool này rồi");
    if (!account.registered) { b.registerStakeCertificate(rewardAddress); expect.certs.push("reg"); }
    b.delegateStakeCertificate(rewardAddress, action.poolId);
    expect.certs.push("deleg");
    expect.poolId = action.poolId;
  } else {
    if (!account.registered) throw new WalletError("INVALID_TX", "Stake key chưa đăng ký");
    if (action.kind === "withdraw" && account.rewards <= 0n) throw new WalletError("INVALID_AMOUNT", "Chưa có phần thưởng để rút");
    // The ledger only deregisters a stake key whose reward balance is zero: withdraw everything in the same tx.
    if (account.rewards > 0n) { b.withdrawal(rewardAddress, account.rewards.toString()); expect.withdrawal = account.rewards; }
    if (action.kind === "deregister") { b.deregisterStakeCertificate(rewardAddress); expect.certs.push("dereg"); }
  }
  b.changeAddress(changeAddress).selectUtxosFrom(utxos);
  let unsignedTx: string;
  try {
    unsignedTx = await b.complete();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/insufficient|not enough|balance/i.test(msg)) throw new WalletError("INSUFFICIENT_FUNDS", "Không đủ ADA cho phí (và cọc 2 ADA khi đăng ký)");
    throw new WalletError("INVALID_TX", `Không dựng được giao dịch: ${msg}`);
  }
  const checked = verifyStakeTx(unsignedTx, utxos, params, expect);
  return { unsignedTx, expect, preview: { txHash: resolveTxHash(unsignedTx), action: action.kind, ...checked } };
}

export const serializeStakePreview = (p: StakePreview) => ({
  ...p, fee: p.fee.toString(), deposit: p.deposit.toString(), refund: p.refund.toString(), withdrawal: p.withdrawal.toString(), change: p.change.toString(),
});
export const serializePool = (p: PoolInfo) => ({ ...p, fixedCost: p.fixedCost.toString(), pledge: p.pledge.toString(), liveStake: p.liveStake.toString() });

// Ví multisig "shared wallet" theo CIP-1854 (khóa) + CIP-0146 (đăng ký/khám phá) — cách Eternl dùng.
import * as bip39 from "bip39";
import { MeshTxBuilder, serializeNativeScript, resolveNativeScriptHash, resolvePaymentKeyHash } from "@meshsdk/core";
import type { UTxO, Protocol } from "@meshsdk/core";
import { Bip32PrivateKey, Cardano, Serialization, resolveTxHash, Ed25519PublicKey, Ed25519Signature, addVKeyWitnessSetToTransaction, deserializeNativeScript, fromNativeScript } from "@meshsdk/core-cst";
import { NETWORKS, type NetworkName } from "./networks";
import { add, assetsOf, memoLines, outputValue, ref, txMemo, valueOf, type Totals } from "./send";

const H = 0x80000000;
const HEX56 = /^[0-9a-f]{56}$/;

export class SharedError extends Error {
  constructor(public code: "INVALID_CONFIG" | "INVALID_TX" | "INVALID_SIGNATURE" | "NOT_SIGNER" | "NOT_ENOUGH" | "INSUFFICIENT_FUNDS" | "NO_SCRIPT" | "EXPIRED", message: string) {
    super(message);
  }
}

export type NativeScriptJson =
  | { type: "sig"; keyHash: string }
  | { type: "all" | "any"; scripts: NativeScriptJson[] }
  | { type: "atLeast"; required: number; scripts: NativeScriptJson[] };

export interface Signer { name: string; keyHash: string }

/** Ví multisig: script thanh toán (+ script stake tùy chọn) và các thông tin suy ra. */
export interface SharedWallet {
  id: string; // `${network}-${paymentScriptHash}`
  name: string;
  network: NetworkName;
  paymentScript: NativeScriptJson;
  stakeScript?: NativeScriptJson;
  paymentScriptHash: string;
  address: string;
  /** Các cosigner biết được (từ metadata đăng ký hoặc do người tạo nhập) */
  signers: Signer[];
  required: number;
  /** Chỉ số khóa y của tôi trong ví này (CIP-146: 1854'/1815'/0'/x/y) */
  myIndex?: number;
  registeredTx?: string;
}

// ---------- Khóa CIP-1854 ----------

const rootOf = (words: string[]) => Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39.mnemonicToEntropy(words.join(" ")), "hex"), "");

/** role 0 = thanh toán, role 2 = stake. Tài khoản luôn là 0 (CIP-0146). */
function sharedKey(words: string[], role: 0 | 2, y: number) {
  if (!Number.isInteger(y) || y < 0 || y >= H) throw new SharedError("INVALID_CONFIG", "Chỉ số khóa không hợp lệ");
  return rootOf(words).derive([1854 + H, 1815 + H, 0 + H, role, y]).toRawKey();
}

export async function sharedKeyHash(words: string[], y: number, role: 0 | 2 = 0): Promise<string> {
  return (await sharedKey(words, role, y).toPublic().hash()).hex();
}

/** Ed25519 public key (hex) of the multisig key — the only thing to share with other cosigners. */
export function sharedPublicKey(words: string[], y: number, role: 0 | 2 = 0): string {
  return sharedKey(words, role, y).toPublic().hex();
}

/** Ký giao dịch bằng khóa multisig (role 0, chỉ số y) → witness set CBOR chỉ chứa chữ ký đó. */
export async function signWithSharedKey(words: string[], y: number, txCbor: string, role: 0 | 2 = 0): Promise<string> {
  const k = sharedKey(words, role, y);
  const sig = await k.sign(resolveTxHash(txCbor) as never);
  const set = new Serialization.TransactionWitnessSet();
  set.setVkeys(Serialization.CborSet.fromCore([[k.toPublic().hex(), sig.hex()]], Serialization.VkeyWitness.fromCore) as never);
  return set.toCbor();
}

// ---------- Script & địa chỉ ----------

export function toKeyHash(input: string): string {
  const s = input.trim().toLowerCase();
  if (HEX56.test(s)) return s;
  try {
    const h = resolvePaymentKeyHash(input.trim());
    if (HEX56.test(h)) return h;
  } catch { /* lỗi chung bên dưới */ }
  throw new SharedError("INVALID_CONFIG", "Không nhận ra khóa cosigner (cần key hash 56 ký tự hex)");
}

/**
 * A cosigner key needs only its public part (AI-7): 28-byte key hash (56 hex), 32-byte Ed25519 public key
 * (64 hex, CIP-1854 m/1854'/1815'/0'/0/y) or an address with a payment key. Never accepts a private key.
 */
export async function cosignerKeyHash(input: string): Promise<string> {
  const s = input.trim().toLowerCase();
  if (/^(addr_shared_sk|addr_sk|addr_xsk|xprv|ed25519_sk|ed25519e_sk)1/.test(s) || /^[0-9a-f]{128}$/.test(s))
    throw new SharedError("INVALID_CONFIG", "Đây là khóa bí mật! Chỉ nhập public key hoặc key hash của cosigner");
  if (/^[0-9a-f]{64}$/.test(s)) {
    try {
      return (await Ed25519PublicKey.fromHex(s as never).hash()).hex();
    } catch {
      throw new SharedError("INVALID_CONFIG", "Public key không hợp lệ");
    }
  }
  return toKeyHash(input);
}

export function buildPaymentScript(required: number, keyHashes: string[]): NativeScriptJson {
  const keys = [...new Set(keyHashes)].sort();
  if (keys.length !== keyHashes.length) throw new SharedError("INVALID_CONFIG", "Cosigner bị trùng");
  if (keys.length < 1 || keys.length > 15) throw new SharedError("INVALID_CONFIG", "Cần 1–15 cosigner");
  for (const k of keys) if (!HEX56.test(k)) throw new SharedError("INVALID_CONFIG", "Key hash không hợp lệ");
  if (!Number.isInteger(required) || required < 1 || required > keys.length) throw new SharedError("INVALID_CONFIG", "Số chữ ký tối thiểu không hợp lệ");
  const sigs = keys.map((keyHash) => ({ type: "sig" as const, keyHash }));
  return required === keys.length ? { type: "all", scripts: sigs } : { type: "atLeast", required, scripts: sigs };
}

export const scriptHashOf = (s: NativeScriptJson) => resolveNativeScriptHash(s as never);
export const scriptCborOf = (s: NativeScriptJson, networkId: 0 | 1 = 0) => serializeNativeScript(s as never, undefined, networkId).scriptCbor!;

export function keysOf(s: NativeScriptJson): string[] {
  return s.type === "sig" ? [s.keyHash] : s.scripts.flatMap(keysOf);
}
export function requiredOf(s: NativeScriptJson): number {
  if (s.type === "atLeast") return s.required;
  if (s.type === "sig" || s.type === "any") return 1;
  return s.scripts.length; // all
}

/** Địa chỉ ví: có script stake thì là địa chỉ base (script thanh toán + script stake), ngược lại là địa chỉ enterprise. */
export function scriptAddress(payment: NativeScriptJson, networkId: 0 | 1, stake?: NativeScriptJson): string {
  // Mesh serializeNativeScript treats its stake argument as a key hash, so a stake script needs a base address built by hand.
  if (!stake) return serializeNativeScript(payment as never, undefined, networkId).address;
  const script = (s: NativeScriptJson) => ({ type: Cardano.CredentialType.ScriptHash, hash: scriptHashOf(s) as never });
  return Cardano.BaseAddress.fromCredentials(networkId, script(payment), script(stake)).toAddress().toBech32();
}
export const sharedAddress = (payment: NativeScriptJson, network: NetworkName, stake?: NativeScriptJson): string =>
  scriptAddress(payment, NETWORKS[network].networkId, stake);

export function makeSharedWallet(p: { name: string; network: NetworkName; paymentScript: NativeScriptJson; stakeScript?: NativeScriptJson; signers?: Signer[]; myIndex?: number; registeredTx?: string }): SharedWallet {
  const hash = scriptHashOf(p.paymentScript);
  const keys = keysOf(p.paymentScript);
  const known = new Map((p.signers ?? []).map((s) => [s.keyHash, s.name]));
  return {
    id: `${p.network}-${hash}`,
    name: p.name,
    network: p.network,
    paymentScript: p.paymentScript,
    stakeScript: p.stakeScript,
    paymentScriptHash: hash,
    address: sharedAddress(p.paymentScript, p.network, p.stakeScript),
    signers: keys.map((keyHash, i) => ({ keyHash, name: known.get(keyHash) ?? `Cosigner ${i + 1}` })),
    required: requiredOf(p.paymentScript),
    myIndex: p.myIndex,
    registeredTx: p.registeredTx,
  };
}

/** Đọc script từ CBOR hex (xuất từ Eternl/Mesh) thành JSON. */
export function scriptFromCbor(cbor: string): NativeScriptJson {
  try {
    return fromNativeScript(deserializeNativeScript(cbor.trim())) as unknown as NativeScriptJson;
  } catch {
    throw new SharedError("NO_SCRIPT", "Không đọc được native script");
  }
}

// ---------- Dựng & kiểm tra giao dịch ----------

const lovelaceOf = (u: UTxO) => BigInt(u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? 0);
const VKEY_WITNESS_BYTES = 101;

/** Dựng giao dịch chưa ký chi ADA từ ví multisig; chỉ dùng UTxO thuộc địa chỉ script (CIP-1854). */
export async function buildSharedSend(w: SharedWallet, utxos: UTxO[], to: string, lovelace: bigint, params?: Partial<Protocol>, opts: { invalidHereafter?: number; memo?: string } = {}): Promise<string> {
  const memo = memoLines(opts.memo);
  const own = utxos.filter((u) => u.output.address === w.address);
  const sorted = [...own].sort((a, b) => (lovelaceOf(b) > lovelaceOf(a) ? 1 : -1));
  const picked: UTxO[] = [];
  let total = 0n;
  for (const u of sorted) {
    picked.push(u);
    total += lovelaceOf(u);
    if (total >= lovelace + 2_000_000n) break;
  }
  if (total < lovelace + 300_000n) throw new SharedError("INSUFFICIENT_FUNDS", "Ví multisig không đủ số dư");
  const scripts = [w.paymentScript];
  const build = async (fee?: bigint) => {
    const b = new MeshTxBuilder({ params });
    for (const u of picked) {
      b.txIn(u.input.txHash, u.input.outputIndex, u.output.amount, w.address);
      b.txInScript(serializeNativeScript(scripts[0] as never, w.stakeScript ? scriptHashOf(w.stakeScript) : undefined, NETWORKS[w.network].networkId).scriptCbor!);
    }
    b.txOut(to, [{ unit: "lovelace", quantity: lovelace.toString() }]).changeAddress(w.address);
    if (opts.invalidHereafter !== undefined) b.invalidHereafter(opts.invalidHereafter); // after this slot it must be proposed again (AI-8)
    if (memo) b.metadataValue(674, { msg: memo }); // CIP-20, inside the signed body so nobody can change it on the way (AI-45)
    if (fee) b.setFee(fee.toString());
    return b.complete();
  };
  let tx = await build();
  const a = BigInt(params?.minFeeA ?? 44), bb = BigInt(params?.minFeeB ?? 155381);
  const need = a * (BigInt(tx.length / 2) + BigInt(w.required * VKEY_WITNESS_BYTES + 8)) + bb;
  if (Serialization.Transaction.fromCbor(tx as never).body().fee() < need) tx = await build(need + 2_000n);
  return tx;
}

export interface WitnessInfo { keyHash: string; vkey: string; signature: string }

/** Đọc các chữ ký trong witness set và kiểm tra thật sự khớp giao dịch. */
export async function readWitnesses(txCbor: string, witnessSetCbor: string): Promise<WitnessInfo[]> {
  let set: Serialization.TransactionWitnessSet;
  try {
    set = Serialization.TransactionWitnessSet.fromCbor(witnessSetCbor as never);
  } catch {
    throw new SharedError("INVALID_SIGNATURE", "Chữ ký không đọc được");
  }
  const txHash = resolveTxHash(txCbor);
  const out: WitnessInfo[] = [];
  for (const v of set.vkeys()?.values() ?? []) {
    const pk = Ed25519PublicKey.fromHex(v.vkey() as never);
    if (!(await pk.verify(Ed25519Signature.fromHex(v.signature() as never), txHash as never))) throw new SharedError("INVALID_SIGNATURE", "Chữ ký không khớp giao dịch");
    out.push({ keyHash: (await pk.hash()).hex(), vkey: v.vkey(), signature: v.signature() });
  }
  return out;
}

export interface AssetQty { unit: string; quantity: string }

/** Largest fee a cosigner signs: a fee is lost to the network, and a real multisig fee is far below this. */
export const MAX_SHARED_FEE = 2_000_000n;

export interface TxPreview {
  txHash: string;
  outputs: { address: string; lovelace: string; tokens: number; assets: AssetQty[]; change: boolean }[];
  fee: string;
  /** CIP-20 message carried in the transaction (lines joined by newlines) */
  memo?: string;
  /** What leaves the wallet, fee included (inputs minus change). Set only when the inputs were checked against the wallet's UTxOs. */
  net?: { lovelace: string; assets: AssetQty[] };
  /** Slot from which the transaction is invalid (invalid_hereafter); undefined = no validity end */
  ttl?: number;
  /** Cosigner đã ký (key hash) */
  signedBy: string[];
  enough: boolean;
}

/**
 * Kiểm tra giao dịch (có thể đã ký một phần) trước khi hỏi người dùng có ký không, theo CIP-1854:
 * script phải đúng ví này; chữ ký có sẵn phải hợp lệ và thuộc cosigner của ví.
 * `requireOtherSigner`: giao dịch nhận từ người khác phải có chữ ký của ít nhất một cosigner (kiểm tra nguồn gốc).
 * AI-45: the transaction may only spend: see assertOnlySpend. `utxos`: the wallet's current UTxOs; when given, every
 * input must be one of them (an input of another wallet, or one already spent, is refused) and `net` is filled.
 */
export async function inspectSharedTx(w: SharedWallet, txCbor: string, opts: { requireOtherSigner?: boolean; myKeyHashes?: string[]; utxos?: UTxO[] } = {}): Promise<TxPreview> {
  if (!/^[0-9a-f]+$/i.test(txCbor) || txCbor.length > 65_536) throw new SharedError("INVALID_TX", "Giao dịch không hợp lệ");
  let tx: Serialization.Transaction;
  try {
    tx = Serialization.Transaction.fromCbor(txCbor as never);
  } catch {
    throw new SharedError("INVALID_TX", "Không đọc được giao dịch");
  }
  assertOnlySpend(w, tx);
  const allowed = new Set(keysOf(w.paymentScript));
  const signedBy: string[] = [];
  for (const v of tx.witnessSet().vkeys()?.values() ?? []) {
    const pk = Ed25519PublicKey.fromHex(v.vkey() as never);
    const ok = await pk.verify(Ed25519Signature.fromHex(v.signature() as never), resolveTxHash(txCbor) as never);
    const kh = (await pk.hash()).hex();
    if (!ok) throw new SharedError("INVALID_SIGNATURE", "Giao dịch chứa chữ ký sai");
    if (!allowed.has(kh)) throw new SharedError("NOT_SIGNER", "Giao dịch chứa chữ ký của người không thuộc ví");
    signedBy.push(kh);
  }
  if (opts.requireOtherSigner) {
    const mine = new Set(opts.myKeyHashes ?? []);
    if (!signedBy.some((k) => !mine.has(k))) throw new SharedError("INVALID_TX", "Giao dịch chưa có chữ ký của cosigner nào khác — không xác minh được nguồn gốc");
  }
  const body = tx.body();
  const memo = txMemo(txCbor);
  return {
    txHash: resolveTxHash(txCbor),
    outputs: body.outputs().map((o) => ({ address: o.address().toBech32(), lovelace: o.amount().coin().toString(), tokens: o.amount().multiasset()?.size ?? 0, assets: qty(outputValue(o)), change: o.address().toBech32() === w.address })),
    fee: body.fee().toString(),
    ...(memo ? { memo: memo.join("\n") } : {}),
    ...(opts.utxos ? { net: netOutflow(w, tx, opts.utxos) } : {}),
    ttl: body.ttl() === undefined ? undefined : Number(body.ttl()),
    signedBy,
    enough: new Set(signedBy).size >= w.required,
  };
}

const qty = (t: Totals): AssetQty[] => assetsOf(t).map((a) => ({ unit: a.unit, quantity: a.quantity.toString() }));
const refuse = (why: string): never => {
  throw new SharedError("INVALID_TX", `${why}: không ký giao dịch này`);
};

/**
 * A multisig transaction may only move funds out of this wallet (AI-45). One signature approves the whole
 * transaction, so anything else it could carry is refused: mint, certificates, withdrawals (until AI-46),
 * collateral, reference inputs, governance, Plutus, scripts other than the wallet's payment script, output
 * datums or reference scripts, metadata other than a CIP-20 message, and a fee above MAX_SHARED_FEE.
 */
function assertOnlySpend(w: SharedWallet, tx: Serialization.Transaction) {
  const b = tx.body();
  const scripts = tx.witnessSet().nativeScripts()?.values() ?? [];
  if (!scripts.some((s) => s.hash() === w.paymentScriptHash)) throw new SharedError("INVALID_TX", "Giao dịch không dùng script của ví này");
  if (scripts.some((s) => s.hash() !== w.paymentScriptHash)) refuse("Giao dịch có script khác ngoài script của ví");
  if (b.mint() !== undefined) refuse("Giao dịch có mint token");
  if (b.certs() !== undefined) refuse("Giao dịch có certificate (đăng ký, ủy thác stake hoặc DRep)");
  if (b.withdrawals() !== undefined) refuse("Giao dịch có rút thưởng");
  if (b.collateral() !== undefined || b.collateralReturn() !== undefined || b.totalCollateral() !== undefined) refuse("Giao dịch có collateral");
  if (b.referenceInputs() !== undefined) refuse("Giao dịch có reference input");
  if (b.votingProcedures() !== undefined || b.proposalProcedures() !== undefined || b.donation() !== undefined || b.currentTreasuryValue() !== undefined || b.update() !== undefined)
    refuse("Giao dịch có nội dung governance");
  if (b.requiredSigners() !== undefined || b.scriptDataHash() !== undefined) refuse("Giao dịch có thành phần của Plutus script");
  const nid = b.networkId();
  if (nid !== undefined && Number(nid) !== NETWORKS[w.network].networkId) refuse("Giao dịch thuộc mạng khác");
  const ws = tx.witnessSet();
  if (ws.bootstraps() !== undefined || ws.plutusV1Scripts() !== undefined || ws.plutusV2Scripts() !== undefined || ws.plutusV3Scripts() !== undefined || ws.plutusData() !== undefined || ws.redeemers() !== undefined)
    refuse("Giao dịch có witness lạ (Plutus hoặc Byron)");
  if (b.outputs().some((o) => o.datum() !== undefined || o.scriptRef() !== undefined)) refuse("Giao dịch có output kèm datum hoặc script");
  const aux = tx.auxiliaryData();
  if (aux) {
    const labels = [...(aux.metadata()?.metadata()?.keys() ?? [])].map(String);
    if (labels.some((l) => l !== "674") || aux.nativeScripts()?.length || aux.plutusV1Scripts()?.length || aux.plutusV2Scripts()?.length || aux.plutusV3Scripts()?.length)
      refuse("Giao dịch có metadata ngoài ghi chú CIP-20");
    if (labels.length && !txMemo(tx.toCbor())) refuse("Ghi chú CIP-20 không đúng định dạng");
  }
  if (BigInt(b.fee()) > MAX_SHARED_FEE) refuse(`Phí quá cao (trên ${Number(MAX_SHARED_FEE) / 1e6} ADA)`);
}

/** Every input must be a current UTxO of the wallet; returns what leaves the wallet (inputs minus change, fee included). */
function netOutflow(w: SharedWallet, tx: Serialization.Transaction, utxos: UTxO[]): { lovelace: string; assets: AssetQty[] } {
  const b = tx.body();
  const own = new Map(utxos.filter((u) => u.output.address === w.address).map((u) => [ref(u.input.txHash, u.input.outputIndex), u]));
  const inputs: Totals = new Map();
  for (const i of b.inputs().values()) {
    const u = own.get(ref(i.transactionId(), i.index()));
    if (!u) refuse("Giao dịch dùng input không thuộc ví này, hoặc input đã bị tiêu");
    for (const [unit, q] of valueOf(u!.output.amount)) add(inputs, unit, q);
  }
  const outputs: Totals = new Map([["lovelace", BigInt(b.fee())]]);
  const change: Totals = new Map();
  for (const o of b.outputs()) {
    const v = outputValue(o);
    for (const [unit, q] of v) {
      add(outputs, unit, q);
      if (o.address().toBech32() === w.address) add(change, unit, q);
    }
  }
  for (const u of new Set([...inputs.keys(), ...outputs.keys()])) if ((inputs.get(u) ?? 0n) !== (outputs.get(u) ?? 0n)) refuse(`Giao dịch không cân bằng (${u})`);
  const net: Totals = new Map();
  for (const [unit, q] of inputs) net.set(unit, q - (change.get(unit) ?? 0n));
  return { lovelace: (net.get("lovelace") ?? 0n).toString(), assets: qty(net) };
}

/** Ghép nhiều witness set vào giao dịch. */
export function attachWitnesses(txCbor: string, witnessSets: string[]): string {
  let tx = txCbor;
  for (const w of witnessSets) tx = addVKeyWitnessSetToTransaction(tx as never, w as never);
  return tx;
}

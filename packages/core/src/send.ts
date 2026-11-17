/**
 * Send ADA and native tokens (AI-5, AI-6).
 *
 * Flow: prepareSend() builds an UNSIGNED transaction from the live preprod protocol parameters, checks
 * balance + min-UTxO and returns a preview (amount, tokens, ADA carried with tokens, fee, change).
 * Only after the user confirms the preview does WalletManager sign exactly that transaction (by tx hash).
 */
import { MeshTxBuilder } from "@meshsdk/core";
import type { UTxO, Protocol } from "@meshsdk/core";
import { Address, Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { WalletError } from "./errors";
import { NETWORKS, type NetworkName } from "./networks";
import { parseUnit } from "./balance";

export interface SendAsset { unit: string; quantity: bigint }
/** One recipient of a payment. */
export interface SendOutput {
  to: string;
  /** Lovelace for the recipient. Omit when sending tokens to use exactly the min-UTxO. */
  lovelace?: bigint;
  assets?: SendAsset[];
}
export interface SendRequest extends Partial<SendOutput> {
  /** Several recipients in one transaction (AI-23). When set, to/lovelace/assets are ignored. */
  outputs?: SendOutput[];
  /**
   * Send max (single recipient): every lovelace left after the fee goes to the recipient. Tokens not
   * requested stay in the wallet in one change output carrying exactly its min-UTxO; no other change.
   */
  max?: boolean;
  /** CIP-20 message (label 674). Public on chain. */
  memo?: string;
}

export interface RecipientPreview {
  to: string;
  /** Lovelace the recipient gets (with tokens: the minimum ADA that must travel with them) */
  lovelace: bigint;
  /** min-UTxO of this output, from the current coinsPerUtxoSize */
  minLovelace: bigint;
  assets: SendAsset[];
}

export interface SendPreview extends RecipientPreview {
  txHash: string;
  /** Every recipient in order; the top-level to/lovelace/minLovelace/assets repeat the first one */
  recipients: RecipientPreview[];
  fee: bigint;
  /** Total lovelace leaving the wallet = all recipients + fee */
  totalLovelace: bigint;
  change: { address: string; lovelace: bigint; assets: SendAsset[] };
  max: boolean;
  /** CIP-20 lines as written on chain */
  memo?: string[];
}

export const MAX_RECIPIENTS = 20;
export const MEMO_LINE_BYTES = 64;
export const MEMO_MAX_LINES = 16;

/**
 * CIP-20 message -> metadata lines of at most 64 UTF-8 bytes. Lines break at newlines and, when longer,
 * between characters (never inside one). Empty input = no memo.
 */
export function memoLines(text: string | undefined): string[] | undefined {
  const t = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t) return undefined;
  const enc = new TextEncoder();
  const lines: string[] = [];
  for (const line of t.split("\n")) {
    let cur = "";
    for (const ch of line) {
      if (enc.encode(cur + ch).length > MEMO_LINE_BYTES) { lines.push(cur); cur = ""; }
      cur += ch;
    }
    lines.push(cur);
  }
  if (lines.length > MEMO_MAX_LINES) throw new WalletError("INVALID_AMOUNT", `Ghi chú quá dài (tối đa ${MEMO_MAX_LINES} dòng × ${MEMO_LINE_BYTES} byte)`);
  return lines;
}

export interface PreparedSend { unsignedTx: string; utxos: UTxO[]; preview: SendPreview }

/** Babbage+: min-UTxO = (160 + serialized output size) * coinsPerUtxoSize. */
export function minUtxoLovelace(outputCborHex: string, coinsPerUtxoSize: number | bigint): bigint {
  return (160n + BigInt(outputCborHex.length / 2)) * BigInt(coinsPerUtxoSize);
}

/**
 * Minimum ADA for an output to `to` carrying `assets`, measured on the real serialized output.
 * Iterates because the CBOR length of the coin itself changes the size.
 */
export function minLovelaceForOutput(to: string, assets: SendAsset[], coinsPerUtxoSize: number | bigint): bigint {
  const tokens = assets.length ? new Map(assets.map((a) => [a.unit as never, a.quantity])) : undefined;
  const size = (coin: bigint) => new Serialization.TransactionOutput(Address.fromBech32(to as never), new Serialization.Value(coin, tokens as never)).toCbor();
  let coin = 1_000_000n;
  for (let i = 0; i < 4; i++) {
    const min = minUtxoLovelace(size(coin), coinsPerUtxoSize);
    if (min === coin) break;
    coin = min;
  }
  return coin;
}

/** The address must be a preprod bech32 Shelley address (addr_test1…, network id 0). */
export function assertPreprodAddress(addr: string, network: NetworkName = "preprod"): void {
  const cfg = NETWORKS[network];
  const bad = () => new WalletError("INVALID_ADDRESS", `Địa chỉ ${cfg.label} không hợp lệ (phải bắt đầu bằng ${cfg.addressPrefix})`);
  const a = addr.trim();
  if (a !== addr || !a.startsWith(cfg.addressPrefix)) throw bad();
  let parsed: ReturnType<typeof Address.fromBech32>;
  try {
    parsed = Address.fromBech32(a as never);
  } catch {
    throw bad();
  }
  if (parsed.getNetworkId() !== cfg.networkId) throw bad();
}

export type Totals = Map<string, bigint>; // "lovelace" | unit -> quantity
export const add = (t: Totals, unit: string, q: bigint) => t.set(unit, (t.get(unit) ?? 0n) + q);
export const valueOf = (amount: { unit: string; quantity: string }[]): Totals => {
  const t: Totals = new Map();
  for (const a of amount) add(t, a.unit === "" ? "lovelace" : a.unit, BigInt(a.quantity));
  return t;
};
export const outputValue = (o: Serialization.TransactionOutput): Totals => {
  const v = o.amount();
  const t: Totals = new Map([["lovelace", BigInt(v.coin())]]);
  for (const [id, q] of v.multiasset() ?? new Map()) add(t, String(id), BigInt(q));
  return t;
};
export const assetsOf = (t: Totals): SendAsset[] =>
  [...t].filter(([u, q]) => u !== "lovelace" && q !== 0n).map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => (a.unit < b.unit ? -1 : 1));
export const ref = (txHash: string, i: number | bigint) => `${txHash}#${Number(i)}`;

/** Validate the requested amounts of one output and return the merged, normalized token list. */
function normalizeOutput(req: SendOutput, allowEmpty = false): { to: string; lovelace?: bigint; assets: SendAsset[] } {
  if (req.lovelace !== undefined && req.lovelace <= 0n) throw new WalletError("INVALID_AMOUNT", "Số ADA phải lớn hơn 0");
  const merged: Totals = new Map();
  for (const a of req.assets ?? []) {
    const unit = a.unit.toLowerCase();
    try { parseUnit(unit); } catch { throw new WalletError("INVALID_AMOUNT", `Token không hợp lệ: ${a.unit}`); }
    if (unit === "lovelace" || a.quantity <= 0n) throw new WalletError("INVALID_AMOUNT", "Số lượng token phải lớn hơn 0");
    add(merged, unit, a.quantity);
  }
  const assets = assetsOf(merged);
  if (!allowEmpty && req.lovelace === undefined && !assets.length) throw new WalletError("INVALID_AMOUNT", "Chưa nhập số tiền");
  return { to: req.to, lovelace: req.lovelace, assets };
}

/** The recipients of a request (single or several). */
export function requestOutputs(req: SendRequest): SendOutput[] {
  const outs = req.outputs ?? (req.to !== undefined ? [{ to: req.to, lovelace: req.lovelace, assets: req.assets }] : []);
  if (!outs.length) throw new WalletError("INVALID_ADDRESS", "Chưa có người nhận");
  if (outs.length > MAX_RECIPIENTS) throw new WalletError("INVALID_AMOUNT", `Tối đa ${MAX_RECIPIENTS} người nhận mỗi giao dịch`);
  if (req.max && outs.length !== 1) throw new WalletError("INVALID_AMOUNT", "Gửi tối đa chỉ dùng với một người nhận");
  return outs;
}

/** Raw minimum fee (for a signed tx), checked before submitting to the node. */
export const minFeeFor = (txCborHex: string, p: Pick<Protocol, "minFeeA" | "minFeeB">) =>
  BigInt(p.minFeeA) * BigInt(txCborHex.length / 2) + BigInt(p.minFeeB);

/** Lines of the CIP-20 message (label 674) in a transaction, undefined when there is none. */
export function txMemo(txCbor: string): string[] | undefined {
  const aux = Serialization.Transaction.fromCbor(txCbor as never).auxiliaryData();
  const md = aux?.metadata()?.metadata();
  const m = md?.get(674n);
  if (!m) return undefined;
  const map = m.asMap();
  if (!map) return undefined;
  const keys = map.getKeys();
  for (let i = 0; i < keys.getLength(); i++) {
    const k = keys.get(i);
    if (k.asText() !== "msg") continue;
    const list = map.get(k)?.asList();
    if (!list) return undefined;
    const out: string[] = [];
    for (let j = 0; j < list.getLength(); j++) out.push(list.get(j).asText() ?? "");
    return out;
  }
  return undefined;
}

export interface SendExpectation {
  /** Recipients in order; lovelace undefined = any amount at or above min-UTxO */
  outputs: { to: string; lovelace?: bigint; assets: SendAsset[] }[];
  changeAddress: string;
  memo?: string[];
}

/**
 * Check a payment transaction before signing:
 * - every input is a wallet UTxO; no mint, certificates or withdrawals (no value besides inputs/outputs)
 * - every asset balances: inputs = outputs + fee (lovelace)
 * - every output meets min-UTxO
 * - outputs to recipients appear in the requested order with exactly the requested lovelace/tokens;
 *   every other output goes to the change address
 * - the transaction carries exactly the expected CIP-20 memo, or no metadata at all
 */
export function verifySendTx(txCbor: string, utxos: UTxO[], params: Protocol, expect: SendExpectation | { to: string; lovelace?: bigint; assets: SendAsset[]; changeAddress: string }) {
  const exp: SendExpectation = "outputs" in expect ? expect : { outputs: [{ to: expect.to, lovelace: expect.lovelace, assets: expect.assets }], changeAddress: expect.changeAddress };
  const tx = Serialization.Transaction.fromCbor(txCbor as never);
  const body = tx.body();
  if (body.mint() || body.certs() || body.withdrawals() || body.collateral() || body.referenceInputs())
    throw new WalletError("INVALID_TX", "Giao dịch chứa thành phần ngoài phạm vi gửi tiền");
  const byRef = new Map(utxos.map((u) => [ref(u.input.txHash, u.input.outputIndex), u]));
  const inputs: Totals = new Map();
  for (const i of body.inputs().values()) {
    const u = byRef.get(ref(i.transactionId(), i.index()));
    if (!u) throw new WalletError("INVALID_TX", "Giao dịch dùng input không thuộc ví");
    for (const [unit, q] of valueOf(u.output.amount)) add(inputs, unit, q);
  }
  const fee = BigInt(body.fee());
  const outputs: Totals = new Map([["lovelace", fee]]);
  const recipients: RecipientPreview[] = [];
  const change: Totals = new Map();
  const same = (a: SendAsset[], b: SendAsset[]) => JSON.stringify(a.map((x) => [x.unit, x.quantity.toString()])) === JSON.stringify(b.map((x) => [x.unit, x.quantity.toString()]));
  body.outputs().forEach((o, idx) => {
    const v = outputValue(o);
    for (const [unit, q] of v) add(outputs, unit, q);
    const min = minUtxoLovelace(o.toCbor(), params.coinsPerUtxoSize);
    if (v.get("lovelace")! < min) throw new WalletError("INVALID_TX", `Output #${idx + 1} dưới min-UTxO`);
    const addr = o.address().toBech32();
    const want = exp.outputs[recipients.length];
    if (want && addr === want.to) {
      const r = { to: addr, lovelace: v.get("lovelace")!, minLovelace: min, assets: assetsOf(v) };
      if (want.lovelace !== undefined && r.lovelace !== want.lovelace) throw new WalletError("INVALID_TX", `Số ADA gửi cho người nhận #${recipients.length + 1} không khớp yêu cầu`);
      if (!same(r.assets, want.assets)) throw new WalletError("INVALID_TX", `Token gửi cho người nhận #${recipients.length + 1} không khớp yêu cầu`);
      recipients.push(r);
    } else if (addr === exp.changeAddress) for (const [unit, q] of v) add(change, unit, q);
    else throw new WalletError("INVALID_TX", "Giao dịch có output tới địa chỉ lạ");
  });
  const units = new Set([...inputs.keys(), ...outputs.keys()]);
  for (const u of units) if ((inputs.get(u) ?? 0n) !== (outputs.get(u) ?? 0n)) throw new WalletError("INVALID_TX", `Giao dịch không cân bằng (${u})`);
  if (recipients.length !== exp.outputs.length) throw new WalletError("INVALID_TX", "Không thấy đủ output tới người nhận");
  const memo = txMemo(txCbor);
  if (JSON.stringify(memo) !== JSON.stringify(exp.memo)) throw new WalletError("INVALID_TX", "Ghi chú trong giao dịch không khớp yêu cầu");
  const labels = [...(tx.auxiliaryData()?.metadata()?.metadata()?.keys() ?? [])].map(String);
  if (labels.some((l) => l !== "674") || tx.auxiliaryData()?.nativeScripts()?.length || tx.auxiliaryData()?.plutusV1Scripts()?.length)
    throw new WalletError("INVALID_TX", "Giao dịch chứa metadata không mong muốn");
  if (fee < minFeeFor(txCbor, params)) throw new WalletError("INVALID_TX", "Phí thấp hơn mức tối thiểu");
  return { fee, recipient: recipients[0]!, recipients, change: { lovelace: change.get("lovelace") ?? 0n, assets: assetsOf(change) } };
}

/** Build an unsigned ADA / token payment to one or more recipients, optionally "send max" and a CIP-20 memo. */
export async function prepareSend(p: { req: SendRequest; utxos: UTxO[]; changeAddress: string; params: Protocol | undefined; network?: NetworkName }): Promise<PreparedSend> {
  const { req, utxos, changeAddress } = p;
  if (!p.params) throw new WalletError("NO_PARAMS", "Không lấy được protocol parameters của preprod; không thể tính phí");
  const params = p.params;
  const max = !!req.max;
  const wanted = requestOutputs(req).map((o) => {
    assertPreprodAddress(o.to, p.network);
    return normalizeOutput(o, max);
  });
  if (max && wanted[0]!.to === changeAddress) throw new WalletError("INVALID_ADDRESS", "Gửi tối đa phải tới một địa chỉ khác ví này");
  if (max && wanted[0]!.lovelace !== undefined) throw new WalletError("INVALID_AMOUNT", "Gửi tối đa không nhận số ADA cụ thể");
  const memo = memoLines(req.memo);

  // Check funds and tokens before building
  const have: Totals = new Map();
  for (const u of utxos) for (const [unit, q] of valueOf(u.output.amount)) add(have, unit, q);
  const need: Totals = new Map();
  for (const o of wanted) for (const a of o.assets) add(need, a.unit, a.quantity);
  for (const [unit, q] of need) {
    const h = have.get(unit) ?? 0n;
    if (h < q) throw new WalletError("INSUFFICIENT_TOKENS", `Không đủ token ${unit.slice(56) || unit.slice(0, 12)}: có ${h}, cần ${q}`);
  }
  // Output ADA: as requested (must meet min-UTxO), or exactly min-UTxO when only tokens are sent.
  const coins = wanted.map((o, i) => {
    const min = minLovelaceForOutput(o.to, o.assets, params.coinsPerUtxoSize);
    if (o.lovelace !== undefined && o.lovelace < min) throw new WalletError("INVALID_AMOUNT", `Người nhận #${i + 1}: cần gửi tối thiểu ${min} lovelace (min-UTxO)`);
    return o.lovelace ?? min;
  });
  const roughFee = BigInt(params.minFeeA) * (400n + 60n * BigInt(wanted.length)) + BigInt(params.minFeeB);
  const funds = () => new WalletError("INSUFFICIENT_FUNDS", "Không đủ ADA (kể cả phí và ADA tối thiểu đi kèm)");
  if ((have.get("lovelace") ?? 0n) < coins.reduce((a, b) => a + b, 0n) + roughFee) throw funds();

  const complete = async (b: MeshTxBuilder) => {
    if (memo) b.metadataValue(674, { msg: memo });
    try {
      return await b.complete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/insufficient|not enough|balance/i.test(msg)) throw funds();
      throw new WalletError("INVALID_TX", `Không dựng được giao dịch: ${msg}`);
    }
  };
  const amount = (coin: bigint, assets: SendAsset[]) => [{ unit: "lovelace", quantity: coin.toString() }, ...assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() }))];

  let tx: string;
  let expect: SendExpectation;
  if (!max) {
    const b = new MeshTxBuilder({ params });
    wanted.forEach((o, i) => b.txOut(o.to, amount(coins[i]!, o.assets)));
    b.changeAddress(changeAddress).selectUtxosFrom(utxos);
    tx = await complete(b);
    expect = { outputs: wanted.map((o, i) => ({ to: o.to, lovelace: coins[i], assets: o.assets })), changeAddress, memo };
  } else {
    // Spend every UTxO. Tokens not sent stay with us in one output holding exactly its min-UTxO; the
    // builder's change (all remaining ADA after the fee, plus the requested tokens) goes to the recipient.
    const r = wanted[0]!;
    const keep: Totals = new Map(have);
    keep.delete("lovelace");
    for (const a of r.assets) add(keep, a.unit, -a.quantity);
    const kept = assetsOf(keep);
    const b = new MeshTxBuilder({ params });
    for (const u of utxos) b.txIn(u.input.txHash, u.input.outputIndex, u.output.amount, u.output.address, 0);
    if (kept.length) b.txOut(changeAddress, amount(minLovelaceForOutput(changeAddress, kept, params.coinsPerUtxoSize), kept));
    b.changeAddress(r.to);
    tx = await complete(b);
    expect = { outputs: [{ to: r.to, assets: r.assets }], changeAddress, memo };
  }

  const checked = verifySendTx(tx, utxos, params, expect);
  if (max && checked.change.lovelace !== 0n && !checked.change.assets.length) throw new WalletError("INVALID_TX", "Gửi tối đa còn để lại tiền thối");
  const sent = checked.recipients.reduce((a, r) => a + r.lovelace, 0n);
  const first = checked.recipients[0]!;
  return {
    unsignedTx: tx,
    utxos,
    preview: {
      txHash: resolveTxHash(tx),
      ...first,
      recipients: checked.recipients,
      fee: checked.fee,
      totalLovelace: sent + checked.fee,
      change: { address: changeAddress, ...checked.change },
      max,
      ...(memo ? { memo } : {}),
    },
  };
}

/** JSON shape (bigint -> string) for RPC. */
export const serializeSendPreview = (p: SendPreview) => ({
  ...p,
  recipients: p.recipients.map((r) => ({ ...r, lovelace: r.lovelace.toString(), minLovelace: r.minLovelace.toString(), assets: r.assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() })) })),
  lovelace: p.lovelace.toString(),
  minLovelace: p.minLovelace.toString(),
  fee: p.fee.toString(),
  totalLovelace: p.totalLovelace.toString(),
  assets: p.assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() })),
  change: { ...p.change, lovelace: p.change.lovelace.toString(), assets: p.change.assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() })) },
});

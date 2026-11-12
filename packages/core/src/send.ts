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
export interface SendRequest {
  to: string;
  /** Lovelace for the recipient. Omit when sending tokens to use exactly the min-UTxO. */
  lovelace?: bigint;
  assets?: SendAsset[];
}

export interface SendPreview {
  txHash: string;
  to: string;
  /** Lovelace the recipient gets (with tokens: the minimum ADA that must travel with them) */
  lovelace: bigint;
  /** min-UTxO of the outgoing output, from the current coinsPerUtxoSize */
  minLovelace: bigint;
  assets: SendAsset[];
  fee: bigint;
  /** Total lovelace leaving the wallet = lovelace + fee */
  totalLovelace: bigint;
  change: { address: string; lovelace: bigint; assets: SendAsset[] };
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

type Totals = Map<string, bigint>; // "lovelace" | unit -> quantity
const add = (t: Totals, unit: string, q: bigint) => t.set(unit, (t.get(unit) ?? 0n) + q);
const valueOf = (amount: { unit: string; quantity: string }[]): Totals => {
  const t: Totals = new Map();
  for (const a of amount) add(t, a.unit === "" ? "lovelace" : a.unit, BigInt(a.quantity));
  return t;
};
const outputValue = (o: Serialization.TransactionOutput): Totals => {
  const v = o.amount();
  const t: Totals = new Map([["lovelace", BigInt(v.coin())]]);
  for (const [id, q] of v.multiasset() ?? new Map()) add(t, String(id), BigInt(q));
  return t;
};
const assetsOf = (t: Totals): SendAsset[] =>
  [...t].filter(([u, q]) => u !== "lovelace" && q !== 0n).map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => (a.unit < b.unit ? -1 : 1));
const ref = (txHash: string, i: number | bigint) => `${txHash}#${Number(i)}`;

/** Validate the requested amounts and return the merged, normalized token list. */
function normalizeRequest(req: SendRequest): { lovelace?: bigint; assets: SendAsset[] } {
  if (req.lovelace !== undefined && req.lovelace <= 0n) throw new WalletError("INVALID_AMOUNT", "Số ADA phải lớn hơn 0");
  const merged: Totals = new Map();
  for (const a of req.assets ?? []) {
    const unit = a.unit.toLowerCase();
    try { parseUnit(unit); } catch { throw new WalletError("INVALID_AMOUNT", `Token không hợp lệ: ${a.unit}`); }
    if (unit === "lovelace" || a.quantity <= 0n) throw new WalletError("INVALID_AMOUNT", "Số lượng token phải lớn hơn 0");
    add(merged, unit, a.quantity);
  }
  const assets = assetsOf(merged);
  if (req.lovelace === undefined && !assets.length) throw new WalletError("INVALID_AMOUNT", "Chưa nhập số tiền");
  return { lovelace: req.lovelace, assets };
}

/** Raw minimum fee (for a signed tx), checked before submitting to the node. */
export const minFeeFor = (txCborHex: string, p: Pick<Protocol, "minFeeA" | "minFeeB">) =>
  BigInt(p.minFeeA) * BigInt(txCborHex.length / 2) + BigInt(p.minFeeB);

/**
 * Check a payment transaction before signing:
 * - every input is a wallet UTxO; no mint, certificates or withdrawals (no value besides inputs/outputs)
 * - every asset balances: inputs = outputs + fee (lovelace)
 * - every output meets min-UTxO
 * - the first output to `to` carries exactly the requested lovelace/tokens; all other outputs go to the change address
 */
export function verifySendTx(txCbor: string, utxos: UTxO[], params: Protocol, expect: { to: string; lovelace?: bigint; assets: SendAsset[]; changeAddress: string }) {
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
  const outs = body.outputs();
  let recipient: { lovelace: bigint; assets: SendAsset[]; min: bigint } | undefined;
  const change: Totals = new Map();
  outs.forEach((o, idx) => {
    const v = outputValue(o);
    for (const [unit, q] of v) add(outputs, unit, q);
    const min = minUtxoLovelace(o.toCbor(), params.coinsPerUtxoSize);
    if (v.get("lovelace")! < min) throw new WalletError("INVALID_TX", `Output #${idx + 1} dưới min-UTxO`);
    const addr = o.address().toBech32();
    if (!recipient && addr === expect.to) recipient = { lovelace: v.get("lovelace")!, assets: assetsOf(v), min };
    else if (addr === expect.changeAddress) for (const [unit, q] of v) add(change, unit, q);
    else throw new WalletError("INVALID_TX", "Giao dịch có output tới địa chỉ lạ");
  });
  const units = new Set([...inputs.keys(), ...outputs.keys()]);
  for (const u of units) if ((inputs.get(u) ?? 0n) !== (outputs.get(u) ?? 0n)) throw new WalletError("INVALID_TX", `Giao dịch không cân bằng (${u})`);
  if (!recipient) throw new WalletError("INVALID_TX", "Không thấy output tới người nhận");
  if (expect.lovelace !== undefined && recipient.lovelace !== expect.lovelace) throw new WalletError("INVALID_TX", "Số ADA gửi không khớp yêu cầu");
  if (JSON.stringify(recipient.assets.map((a) => [a.unit, a.quantity.toString()])) !== JSON.stringify(expect.assets.map((a) => [a.unit, a.quantity.toString()])))
    throw new WalletError("INVALID_TX", "Token gửi không khớp yêu cầu");
  if (fee < minFeeFor(txCbor, params)) throw new WalletError("INVALID_TX", "Phí thấp hơn mức tối thiểu");
  return { fee, recipient, change: { lovelace: change.get("lovelace") ?? 0n, assets: assetsOf(change) } };
}

/** Build an unsigned ADA / token payment. */
export async function prepareSend(p: { req: SendRequest; utxos: UTxO[]; changeAddress: string; params: Protocol | undefined; network?: NetworkName }): Promise<PreparedSend> {
  const { req, utxos, changeAddress } = p;
  if (!p.params) throw new WalletError("NO_PARAMS", "Không lấy được protocol parameters của preprod; không thể tính phí");
  const params = p.params;
  assertPreprodAddress(req.to, p.network);
  const { lovelace, assets } = normalizeRequest(req);

  // Check funds and tokens before building
  const have: Totals = new Map();
  for (const u of utxos) for (const [unit, q] of valueOf(u.output.amount)) add(have, unit, q);
  for (const a of assets) {
    const h = have.get(a.unit) ?? 0n;
    if (h < a.quantity) throw new WalletError("INSUFFICIENT_TOKENS", `Không đủ token ${a.unit.slice(56) || a.unit.slice(0, 12)}: có ${h}, cần ${a.quantity}`);
  }
  // Output ADA: as requested (must meet min-UTxO), or exactly min-UTxO when only tokens are sent.
  const min = minLovelaceForOutput(req.to, assets, params.coinsPerUtxoSize);
  if (lovelace !== undefined && lovelace < min) throw new WalletError("INVALID_AMOUNT", `Cần gửi tối thiểu ${min} lovelace (min-UTxO)`);
  const coin = lovelace ?? min;
  const roughFee = BigInt(params.minFeeA) * 400n + BigInt(params.minFeeB);
  if ((have.get("lovelace") ?? 0n) < coin + roughFee) throw new WalletError("INSUFFICIENT_FUNDS", "Không đủ ADA (kể cả phí và ADA tối thiểu đi kèm)");

  const build = async (coin: bigint) => {
    const b = new MeshTxBuilder({ params });
    b.txOut(req.to, [{ unit: "lovelace", quantity: coin.toString() }, ...assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() }))])
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos);
    try {
      return await b.complete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/insufficient|not enough|balance/i.test(msg)) throw new WalletError("INSUFFICIENT_FUNDS", "Không đủ ADA (kể cả phí và ADA tối thiểu đi kèm)");
      throw new WalletError("INVALID_TX", `Không dựng được giao dịch: ${msg}`);
    }
  };
  const tx = await build(coin);

  const checked = verifySendTx(tx, utxos, params, { to: req.to, lovelace: lovelace ?? coin, assets, changeAddress });
  return {
    unsignedTx: tx,
    utxos,
    preview: {
      txHash: resolveTxHash(tx),
      to: req.to,
      lovelace: checked.recipient.lovelace,
      minLovelace: checked.recipient.min,
      assets,
      fee: checked.fee,
      totalLovelace: checked.recipient.lovelace + checked.fee,
      change: { address: changeAddress, ...checked.change },
    },
  };
}

/** JSON shape (bigint -> string) for RPC. */
export const serializeSendPreview = (p: SendPreview) => ({
  ...p,
  lovelace: p.lovelace.toString(),
  minLovelace: p.minLovelace.toString(),
  fee: p.fee.toString(),
  totalLovelace: p.totalLovelace.toString(),
  assets: p.assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() })),
  change: { ...p.change, lovelace: p.change.lovelace.toString(), assets: p.change.assets.map((a) => ({ unit: a.unit, quantity: a.quantity.toString() })) },
});

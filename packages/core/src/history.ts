import { formatAda } from "./balance";

/** One entry of an address's transaction list, newest first. */
export interface TxRef {
  hash: string;
  blockTime: number;
  blockHeight: number;
}

/** A transaction input or output as the data source returns it (amounts as decimal strings). */
export interface RawIO {
  address: string;
  lovelace: string;
  assets: { unit: string; quantity: string }[];
}

/** A transaction with its inputs, outputs and (when asked for) metadata. Same shape for Koios and Blockfrost. */
export interface RawTx {
  hash: string;
  blockTime: number;
  blockHeight: number;
  fee: string;
  inputs: RawIO[];
  outputs: RawIO[];
  /** label -> JSON value; undefined when the metadata was not fetched */
  metadata?: Record<string, unknown>;
}

export type TxDirection = "in" | "out" | "self";

/** A transaction as seen from one address (AI-21). Amounts are bigint, never floats. */
export interface TxDetail {
  hash: string;
  blockTime: number;
  blockHeight: number;
  /** The address(es) the net change is computed for */
  own: string[];
  direction: TxDirection;
  /** Net ADA change of the address, fee included (negative = spent) */
  netLovelace: bigint;
  /** Net change of each native asset (zero changes left out) */
  tokens: { unit: string; quantity: bigint }[];
  fee: bigint;
  /** Fee paid by this address: the fee when it funded an input, else 0 */
  feePaid: bigint;
  inputs: RawIO[];
  outputs: RawIO[];
  metadata?: Record<string, unknown>;
  /** CIP-20 message (label 674), lines joined with a newline */
  memo?: string;
}

export interface HistoryPage {
  items: TxDetail[];
  hasMore: boolean;
}

/** Data source operations the history needs (part of ChainClient). */
export interface HistorySource {
  /** Transactions of one or several addresses (merged, no duplicates), newest first; page starts at 1 */
  listAddressTxs(address: string | string[], page: number, count: number): Promise<TxRef[]>;
  /** Full transactions; metadata only when withMetadata (costs one extra request per tx on Blockfrost) */
  getTxs(hashes: string[], withMetadata: boolean): Promise<RawTx[]>;
}

export const MEMO_LABEL = "674";
export const MAX_PAGE_SIZE = 50;
export const MAX_EXPORT_TXS = 2000;

/** CIP-20: { "674": { "msg": ["line", ...] } }. Accepts a single string too. */
export function readMemo(metadata?: Record<string, unknown>): string | undefined {
  const m = metadata?.[MEMO_LABEL] as { msg?: unknown } | undefined;
  const msg = m?.msg;
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg) && msg.every((x) => typeof x === "string")) return msg.join("\n") || undefined;
  return undefined;
}

/** Net change of ADA and tokens for the addresses in `mine`, plus direction and fee paid. */
export function analyzeTx(raw: RawTx, mine: string | string[]): TxDetail {
  const own = new Set(Array.isArray(mine) ? mine : [mine]);
  let net = 0n;
  const tokens = new Map<string, bigint>();
  const add = (io: RawIO, sign: 1n | -1n) => {
    net += sign * BigInt(io.lovelace);
    for (const a of io.assets) tokens.set(a.unit, (tokens.get(a.unit) ?? 0n) + sign * BigInt(a.quantity));
  };
  for (const o of raw.outputs) if (own.has(o.address)) add(o, 1n);
  for (const i of raw.inputs) if (own.has(i.address)) add(i, -1n);
  const funded = raw.inputs.some((i) => own.has(i.address));
  const allToMe = raw.outputs.length > 0 && raw.outputs.every((o) => own.has(o.address));
  const fee = BigInt(raw.fee);
  return {
    hash: raw.hash,
    blockTime: raw.blockTime,
    blockHeight: raw.blockHeight,
    own: [...own],
    direction: !funded ? "in" : allToMe ? "self" : "out",
    netLovelace: net,
    tokens: [...tokens].filter(([, q]) => q !== 0n).map(([unit, quantity]) => ({ unit, quantity })),
    fee,
    feePaid: funded ? fee : 0n,
    inputs: raw.inputs,
    outputs: raw.outputs,
    metadata: raw.metadata,
    memo: readMemo(raw.metadata),
  };
}

const clampCount = (n: number) => Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(n) || 10));

/** One page of history (newest first). hasMore is true when the page was full. */
export async function historyPage(src: HistorySource, address: string | string[], page = 1, count = 10, withMetadata = false): Promise<HistoryPage> {
  const size = clampCount(count);
  const refs = await src.listAddressTxs(address, Math.max(1, Math.floor(page) || 1), size);
  if (!refs.length) return { items: [], hasMore: false };
  const raws = await src.getTxs(refs.map((r) => r.hash), withMetadata);
  const byHash = new Map(raws.map((r) => [r.hash, r]));
  const items = refs.flatMap((r) => {
    const raw = byHash.get(r.hash);
    return raw ? [analyzeTx({ ...raw, blockTime: raw.blockTime || r.blockTime, blockHeight: raw.blockHeight || r.blockHeight }, address)] : [];
  });
  return { items, hasMore: refs.length === size };
}

export class HistoryError extends Error {}

/**
 * All transactions with blockTime in [from, to] (unix seconds, inclusive), newest first.
 * Walks the list pages until it passes `from`; refuses more than `max` transactions.
 */
export async function historyRange(src: HistorySource, address: string | string[], from: number, to: number, max = MAX_EXPORT_TXS): Promise<TxDetail[]> {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new HistoryError("Khoảng thời gian không hợp lệ");
  const picked: TxRef[] = [];
  for (let page = 1; ; page++) {
    const refs = await src.listAddressTxs(address, page, MAX_PAGE_SIZE);
    picked.push(...refs.filter((r) => r.blockTime >= from && r.blockTime <= to));
    if (picked.length > max) throw new HistoryError(`Quá ${max} giao dịch trong khoảng này, hãy thu hẹp khoảng thời gian`);
    const last = refs[refs.length - 1];
    if (refs.length < MAX_PAGE_SIZE || !last || last.blockTime < from) break;
  }
  const out: TxDetail[] = [];
  for (let i = 0; i < picked.length; i += MAX_PAGE_SIZE) {
    const chunk = picked.slice(i, i + MAX_PAGE_SIZE);
    const byHash = new Map((await src.getTxs(chunk.map((r) => r.hash), true)).map((r) => [r.hash, r]));
    for (const r of chunk) {
      const raw = byHash.get(r.hash);
      if (raw) out.push(analyzeTx({ ...raw, blockTime: raw.blockTime || r.blockTime, blockHeight: raw.blockHeight || r.blockHeight }, address));
    }
  }
  return out;
}

/** CSV cell: quoted when needed; text that a spreadsheet would run as a formula gets a leading apostrophe. */
function cell(v: string, text = false): string {
  const s = text && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ["date_utc", "tx_hash", "direction", "net_ada", "fee_paid_ada", "token_changes", "memo"];

/** CSV for tax records: exact amounts (ADA with 6 decimals, token quantities as integers). */
export function historyCsv(items: TxDetail[]): string {
  const rows = items.map((t) => [
    cell(new Date(t.blockTime * 1000).toISOString()),
    cell(t.hash),
    cell(t.direction),
    cell(formatAda(t.netLovelace)),
    cell(formatAda(t.feePaid)),
    cell(t.tokens.map((x) => `${x.unit}:${x.quantity}`).join(" ")),
    cell(t.memo ?? "", true),
  ].join(","));
  return [CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

/** bigint -> string for messages between the service worker and the popup. */
export function serializeTxDetail(t: TxDetail) {
  return {
    ...t,
    netLovelace: t.netLovelace.toString(),
    fee: t.fee.toString(),
    feePaid: t.feePaid.toString(),
    tokens: t.tokens.map((x) => ({ unit: x.unit, quantity: x.quantity.toString() })),
  };
}
export type SerializedTxDetail = ReturnType<typeof serializeTxDetail>;

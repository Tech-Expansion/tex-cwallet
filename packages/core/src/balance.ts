import type { UTxO } from "@meshsdk/core";
import type { AssetBalance } from "./koios";

/** A native asset in the wallet. Quantity is always a bigint (never a float). */
export interface AssetInfo {
  /** policyId + assetNameHex (Mesh/Blockfrost unit format) */
  unit: string;
  policyId: string;
  assetNameHex: string;
  /** Readable name when assetName is printable UTF-8; otherwise undefined */
  assetName?: string;
  quantity: bigint;
}

export interface WalletBalance {
  lovelace: bigint;
  /** ADA with exactly 6 decimals, e.g. "12.500000" */
  ada: string;
  assets: AssetInfo[];
}

const HEX = /^[0-9a-f]*$/;
const POLICY_HEX_LEN = 56;

/** lovelace -> ADA string with 6 decimals. No floats, so no rounding errors. */
export function formatAda(lovelace: bigint | string): string {
  const n = BigInt(lovelace);
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
}

/** Hex asset name -> readable string when it is valid UTF-8 without control characters. */
export function decodeAssetName(hex: string): string | undefined {
  if (!hex || hex.length % 2 || !HEX.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u001f\u007f-\u009f]/.test(s) ? undefined : s;
  } catch {
    return undefined;
  }
}

/** Split a unit into policyId (28 bytes) + asset name. */
export function parseUnit(unit: string): { policyId: string; assetNameHex: string } {
  const u = unit.toLowerCase();
  if (u.length < POLICY_HEX_LEN || u.length > POLICY_HEX_LEN + 64 || u.length % 2 || !HEX.test(u))
    throw new Error(`Unit không hợp lệ: ${unit}`);
  return { policyId: u.slice(0, POLICY_HEX_LEN), assetNameHex: u.slice(POLICY_HEX_LEN) };
}

/** Sum balances over a list of UTxOs (the canonical source of a wallet balance). */
export function balanceFromUtxos(utxos: UTxO[]): AssetBalance[] {
  const totals = new Map<string, bigint>();
  for (const u of utxos)
    for (const a of u.output.amount) totals.set(a.unit, (totals.get(a.unit) ?? 0n) + BigInt(a.quantity));
  return [...totals].map(([unit, q]) => ({ unit, quantity: q.toString() }));
}

/** Group balances into ADA + assets (stable order by policy, then name). Drops zero quantities. */
export function summarizeBalance(balances: AssetBalance[]): WalletBalance {
  let lovelace = 0n;
  const byUnit = new Map<string, bigint>();
  for (const b of balances) {
    const q = BigInt(b.quantity);
    if (b.unit === "lovelace" || b.unit === "") lovelace += q;
    else {
      const unit = b.unit.toLowerCase();
      byUnit.set(unit, (byUnit.get(unit) ?? 0n) + q);
    }
  }
  const assets: AssetInfo[] = [...byUnit]
    .filter(([, q]) => q !== 0n)
    .map(([unit, quantity]) => {
      const { policyId, assetNameHex } = parseUnit(unit);
      return { unit, policyId, assetNameHex, assetName: decodeAssetName(assetNameHex), quantity };
    })
    .sort((a, b) => (a.policyId === b.policyId ? cmp(a.assetNameHex, b.assetNameHex) : cmp(a.policyId, b.policyId)));
  return { lovelace, ada: formatAda(lovelace), assets };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON shape (bigint -> string) for the extension RPC. */
export const serializeBalance = (b: WalletBalance) => ({
  lovelace: b.lovelace.toString(),
  ada: b.ada,
  assets: b.assets.map((a) => ({ ...a, quantity: a.quantity.toString() })),
});

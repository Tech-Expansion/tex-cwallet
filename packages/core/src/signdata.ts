/** CIP-8 / CIP-30 signData review and signature check (AI-26). */
import { checkSignature } from "@meshsdk/core";
import { Address, Serialization } from "@meshsdk/core-cst";
import { WalletError } from "./errors";

export interface SignDataView {
  /** Signing address as bech32 (or the raw input when it cannot be read) */
  address: string;
  /** Payload as text when it is printable UTF-8 */
  text?: string;
  hex: string;
  /** The payload parses as a transaction or transaction body: signing it may authorize spending */
  looksLikeTx: boolean;
}

const HEX = /^([0-9a-f]{2})*$/i;

/** Printable UTF-8 text of a hex payload, or undefined. */
export function payloadText(hex: string): string | undefined {
  if (!hex || !HEX.test(hex)) return undefined;
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16))));
    return /^[\p{L}\p{N}\p{P}\p{S}\p{M}\p{Zs}\n\r\t]+$/u.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Does the hex parse as a Cardano transaction, transaction body or transaction hash-like 32 bytes? */
export function looksLikeTransaction(hex: string): boolean {
  if (!hex || !HEX.test(hex) || hex.length < 64) return false;
  for (const parse of [(h: string) => Serialization.Transaction.fromCbor(h as never), (h: string) => Serialization.TransactionBody.fromCbor(h as never)]) {
    try {
      const x = parse(hex);
      if (x && (x as { toCbor(): string }).toCbor().toLowerCase() === hex.toLowerCase()) return true;
    } catch { /* not this type */ }
  }
  return false;
}

/** What the approval popup shows for a dApp signData request (AC-001, AC-002). */
export function inspectSignData(address: string, payloadHex: string): SignDataView {
  const hex = String(payloadHex ?? "").toLowerCase();
  if (!HEX.test(hex)) throw new WalletError("INVALID_TX", "Payload signData phải là hex");
  let bech = String(address ?? "");
  try { bech = /^[0-9a-f]+$/i.test(bech) ? Address.fromBytes(bech as never).toBech32() : Address.fromBech32(bech as never).toBech32(); } catch { /* keep raw */ }
  const text = payloadText(hex);
  return { address: bech, ...(text !== undefined ? { text } : {}), hex, looksLikeTx: looksLikeTransaction(hex) };
}

const utf8Hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Verify a CIP-8 signature (COSE_Sign1 + COSE_Key, hex) over a payload (AC-003). When an address is given,
 * the key must also belong to it.
 */
export async function verifyDataSignature(p: { payload: string; payloadIsHex?: boolean; signature: string; key: string; address?: string }): Promise<boolean> {
  const sig = p.signature.trim().toLowerCase();
  const key = p.key.trim().toLowerCase();
  if (!HEX.test(sig) || !sig || !HEX.test(key) || !key) throw new WalletError("INVALID_TX", "Chữ ký và key phải là hex (COSE_Sign1, COSE_Key)");
  const data = p.payloadIsHex ? p.payload.trim().toLowerCase() : utf8Hex(p.payload);
  if (!HEX.test(data)) throw new WalletError("INVALID_TX", "Payload hex không hợp lệ");
  try {
    return await checkSignature(data, { signature: sig, key }, p.address?.trim() || undefined);
  } catch {
    return false;
  }
}

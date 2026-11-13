import { WalletError } from "./errors";
import { assertPreprodAddress } from "./send";
import type { NetworkName } from "./networks";

/** A saved recipient (AI-22). Kept only in the wallet's local state; never sent anywhere. */
export interface Contact {
  id: string;
  name: string;
  address: string;
  note?: string;
  createdAt: number;
}

export const CONTACT_NAME_MAX = 40;
export const CONTACT_NOTE_MAX = 200;
export const CONTACTS_MAX = 500;

/** Validate and normalize a contact before saving. Throws WalletError on bad input. */
export function checkContact(input: { name: string; address: string; note?: string }, network: NetworkName): { name: string; address: string; note?: string } {
  const name = String(input.name ?? "").trim();
  const address = String(input.address ?? "").trim();
  const note = String(input.note ?? "").trim();
  if (!name) throw new WalletError("INVALID_CONTACT", "Tên liên hệ không được để trống");
  if ([...name].length > CONTACT_NAME_MAX) throw new WalletError("INVALID_CONTACT", `Tên liên hệ tối đa ${CONTACT_NAME_MAX} ký tự`);
  if ([...note].length > CONTACT_NOTE_MAX) throw new WalletError("INVALID_CONTACT", `Ghi chú tối đa ${CONTACT_NOTE_MAX} ký tự`);
  assertPreprodAddress(address, network);
  return { name, address, ...(note ? { note } : {}) };
}

// ---------- ADA Handle (AI-22 AC-003) ----------

/**
 * ADA Handle minting policy. The same id on mainnet, preprod and preview. Handles minted under the newer
 * decentralized-minting policy are not resolved yet (add its id here once confirmed).
 */
export const HANDLE_POLICIES = ["f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"] as const;
/** CIP-67 label (222) of the user token of a CIP-68 handle */
export const CIP68_USER_LABEL = "000de140";

/** "$Alice" -> "alice"; undefined when it is not a root handle (sub-handles "x@y" are not supported). */
export function parseHandle(input: string): string | undefined {
  const m = /^\$([a-z0-9_.-]{1,15})$/.exec(input.trim().toLowerCase());
  return m?.[1];
}

const hexOf = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

/** Asset units a handle can live under: legacy CIP-25 name and CIP-68 user token, for each policy. */
export function handleUnits(name: string): string[] {
  const hex = hexOf(name);
  return HANDLE_POLICIES.flatMap((p) => [p + CIP68_USER_LABEL + hex, p + hex]);
}

export interface HandleSource {
  /** Addresses currently holding a positive quantity of the asset (empty when the asset does not exist) */
  assetAddresses(unit: string): Promise<string[]>;
}

export interface ResolvedHandle {
  handle: string;
  address: string;
  unit: string;
}

/** Find the single address holding the handle token on the current network; refuses non-preprod addresses. */
export async function resolveHandle(src: HandleSource, input: string, network: NetworkName): Promise<ResolvedHandle> {
  const name = parseHandle(input);
  if (!name) throw new WalletError("INVALID_HANDLE", "Handle không hợp lệ: dạng $ten, 1–15 ký tự a-z, 0-9, _ . -");
  for (const unit of handleUnits(name)) {
    const holders = [...new Set(await src.assetAddresses(unit))];
    if (!holders.length) continue;
    if (holders.length > 1) throw new WalletError("INVALID_HANDLE", `Handle $${name} đang nằm ở nhiều địa chỉ, không dùng được`);
    const address = holders[0]!;
    assertPreprodAddress(address, network);
    return { handle: `$${name}`, address, unit };
  }
  throw new WalletError("HANDLE_NOT_FOUND", `Không tìm thấy handle $${name} trên mạng này`);
}

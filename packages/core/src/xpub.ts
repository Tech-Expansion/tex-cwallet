/**
 * Watch-only wallet from an account public key (AI-27): acct_xvk / xpub (CIP-1852 m/1852'/1815'/a').
 * Only public keys are ever accepted; addresses are derived with a gap limit of 20.
 */
import { bech32 } from "bech32";
import { Bip32PublicKey, Crypto, buildBaseAddress, buildRewardAddress } from "@meshsdk/core-cst";
import { WalletError } from "./errors";
import { NETWORKS, type NetworkName } from "./networks";

export const GAP_LIMIT = 20;
/** Upper bound on addresses scanned per role, so a corrupt source cannot make the wallet loop forever */
export const MAX_SCAN = 500;

const SECRET_PREFIXES = ["acct_xsk", "root_xsk", "addr_xsk", "stake_xsk", "xprv", "acct_sk", "addr_sk", "ed25519e_sk", "ed25519_sk"];
const PUBLIC_PREFIXES = ["acct_xvk", "xpub"];

const bad = (msg: string) => new WalletError("INVALID_ADDRESS", msg);

/**
 * Parse an account public key: bech32 acct_xvk… / xpub… or 128 hex (64 bytes: key + chain code).
 * Private keys (acct_xsk, xprv, …) and anything of another length are refused without echoing them.
 */
export function parseAccountKey(input: string): string {
  const s = String(input ?? "").trim();
  const lower = s.toLowerCase();
  if (SECRET_PREFIXES.some((p) => lower.startsWith(p))) throw bad("Đây là khoá bí mật. Ví chỉ xem chỉ nhận khoá công khai (acct_xvk… hoặc xpub…); đừng dán khoá bí mật vào bất kỳ đâu");
  let hex: string;
  if (PUBLIC_PREFIXES.some((p) => lower.startsWith(p + "1"))) {
    try {
      const d = bech32.decode(lower, 1000);
      if (!PUBLIC_PREFIXES.includes(d.prefix)) throw new Error();
      hex = Buffer.from(bech32.fromWords(d.words)).toString("hex");
    } catch {
      throw bad("Khoá công khai bech32 không hợp lệ (sai checksum)");
    }
  } else if (/^[0-9a-f]+$/i.test(s)) {
    if (s.length !== 128) throw bad(s.length > 128 ? "Chuỗi hex này dài hơn khoá công khai: có thể là khoá bí mật, ví không nhận" : "Khoá công khai hex phải dài 128 ký tự");
    hex = lower;
  } else {
    throw bad("Cần khoá công khai account (acct_xvk… hoặc xpub…)");
  }
  if (hex.length !== 128) throw bad("Khoá công khai account phải dài 64 byte");
  try {
    Bip32PublicKey.fromHex(hex as never);
  } catch {
    throw bad("Khoá công khai không hợp lệ");
  }
  return hex;
}

export const toAcctXvk = (hex: string) => bech32.encode("acct_xvk", bech32.toWords(Buffer.from(hex, "hex")), 1000);

export interface XpubAddresses {
  external: string[];
  internal: string[];
  /** First never-used external address: where to receive */
  receive: string;
  stakeAddress: string;
}

export interface AccountAddressSource {
  /** Every address seen on chain with this stake address (used or not now) */
  accountAddresses(stakeAddress: string): Promise<string[]>;
}

/** Derive base addresses role/index with the account's stake key (role 2, index 0). */
export async function deriveXpub(hex: string, network: NetworkName) {
  await Crypto.ready();
  const acct = Bip32PublicKey.fromHex(hex as never);
  const networkId = NETWORKS[network].networkId;
  const stakeHash = acct.derive([2, 0]).toRawKey().hash().hex();
  const stakeAddress = buildRewardAddress(networkId, stakeHash as never).toAddress().toBech32();
  const address = (role: 0 | 1, i: number) => buildBaseAddress(networkId, acct.derive([role, i]).toRawKey().hash().hex() as never, stakeHash as never).toAddress().toBech32();
  return { stakeAddress, address };
}

/**
 * Scan external (role 0) and internal (role 1) addresses until GAP_LIMIT consecutive unused ones (AC-002).
 * Returns the used addresses of each role plus the first unused external one.
 */
export async function scanXpub(hex: string, network: NetworkName, src: AccountAddressSource): Promise<XpubAddresses> {
  const d = await deriveXpub(hex, network);
  const used = new Set(await src.accountAddresses(d.stakeAddress));
  const scan = (role: 0 | 1) => {
    const found: string[] = [];
    let firstUnused: string | undefined;
    for (let i = 0, gap = 0; gap < GAP_LIMIT && i < MAX_SCAN; i++) {
      const a = d.address(role, i);
      if (used.has(a)) { found.push(a); gap = 0; } else { firstUnused ??= a; gap++; }
    }
    return { found, firstUnused: firstUnused ?? d.address(role, 0) };
  };
  const ext = scan(0);
  const int = scan(1);
  return { external: ext.found, internal: int.found, receive: ext.firstUnused, stakeAddress: d.stakeAddress };
}

/** All addresses to read balance and history from (at least the receive address). */
export const xpubAddressList = (x: XpubAddresses) => [...new Set([...x.external, ...x.internal, x.receive])];

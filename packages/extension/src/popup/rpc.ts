export class RpcError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Gọi service worker. Có thể thay thế trong test. */
export let rpc = async <T = any>(req: Record<string, unknown>): Promise<T> => {
  const r = await chrome.runtime.sendMessage({ kind: "wallet", req });
  if (!r?.ok) throw new RpcError(r?.error ?? "Lỗi không xác định", r?.code);
  return r.data as T;
};
export const setRpc = (f: typeof rpc) => (rpc = f);

export interface WalletMeta { id: string; name: string; kind: "mnemonic" | "watch"; accounts: { index: number; name: string }[]; address?: string }
export type NetName = "preprod";
export interface NetInfo { name: NetName; label: string; faucetUrl?: string; explorerTxUrl: string; unit: "tADA"; addressPrefix: string }
export interface AppState {
  hasVault: boolean;
  unlocked: boolean;
  wallets: WalletMeta[];
  active: { walletId?: string; account: number };
  network: NetName;
  provider: { proxyUrl?: string; proxyForTestnets?: boolean };
  ipfsGateway?: string;
  ipfsGateways?: string[];
  networks: NetInfo[];
}
export interface Approval {
  id: string; origin: string; kind: "enable" | "signTx" | "signData"; detail?: string;
  signData?: { address: string; text?: string; hex: string; looksLikeTx: boolean };
}

export const fmtAda = (lovelace: string | bigint) => {
  const n = BigInt(lovelace);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${(a / 1_000_000n).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
};

/** "12.5" -> 12500000n; null nếu sai định dạng */
export const parseAda = (s: string): bigint | null => {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) return null;
  const [i, f = ""] = s.trim().split(".");
  return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};

export const shorten = (a: string, n = 10) => (a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

// ---- Multisig (CIP-1854 / CIP-0146) ----
export interface SharedSigner { name: string; keyHash: string }
export interface SharedWalletInfo {
  id: string; name: string; network: NetName; address: string; required: number;
  signers: SharedSigner[]; myIndex?: number; registeredTx?: string; paymentScriptHash: string;
}
export interface TxPreview {
  txHash: string; fee: string; ttl?: number; signedBy: string[]; enough: boolean;
  outputs: { address: string; lovelace: string; tokens: number; assets: { unit: string; quantity: string }[]; change: boolean }[];
  /** CIP-20 message inside the transaction */
  memo?: string;
  /** What leaves the wallet, fee included; only after the inputs were checked against the wallet's UTxOs (AI-45) */
  net?: { lovelace: string; assets: { unit: string; quantity: string }[] };
}
export type SharedInput = { kind: "signRequest"; walletId: string } | { kind: "wallet" } | { kind: "cosignerKey"; keyHash: string } | { kind: "unknown" };
export interface RequestItem { request: string; memo?: string; createdAt: number; preview: TxPreview; iSigned: boolean; stale: boolean; expired: boolean; slotsLeft?: number }

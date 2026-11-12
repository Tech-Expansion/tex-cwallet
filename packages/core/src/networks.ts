/**
 * The wallet runs on preprod only (Epic AI-1). No configuration can point at mainnet:
 * NetworkName is only "preprod", and every network value read from outside (stored state,
 * environment variables, RPC params) must go through assertNetwork().
 */
export type NetworkName = "preprod";

export interface NetworkConfig {
  name: NetworkName;
  label: string;
  /** Cardano network id: 0 = testnet */
  networkId: 0;
  /** Preprod addresses start with this prefix */
  addressPrefix: "addr_test1";
  /** Đơn vị hiển thị */
  unit: "tADA";
  /** Default data source: public Koios, no API key */
  defaultProvider: { kind: "koios"; url: string };
  /** Tên mạng trong đường dẫn của proxy / Blockfrost */
  proxyPath: "preprod";
  explorerTxUrl: string;
  faucetUrl: string;
}

export const PREPROD: NetworkConfig = Object.freeze({
  name: "preprod",
  label: "Preprod",
  networkId: 0,
  addressPrefix: "addr_test1",
  unit: "tADA",
  defaultProvider: Object.freeze({ kind: "koios", url: "https://preprod.koios.rest/api/v1" }),
  proxyPath: "preprod",
  explorerTxUrl: "https://preprod.cardanoscan.io/transaction/",
  faucetUrl: "https://docs.cardano.org/cardano-testnets/tools/faucet",
}) as NetworkConfig;

export const NETWORKS: Readonly<Record<NetworkName, NetworkConfig>> = Object.freeze({ preprod: PREPROD });

export const DEFAULT_NETWORK: NetworkName = "preprod";
export const NETWORK_NAMES: readonly NetworkName[] = ["preprod"];

export class UnsupportedNetworkError extends Error {
  readonly code = "UNSUPPORTED_NETWORK";
  constructor(readonly value: unknown) {
    super(`Mạng không được hỗ trợ: ${JSON.stringify(value)}. Ví này chỉ chạy trên preprod.`);
  }
}

/** Validate a network value from outside. Anything other than "preprod" is rejected. */
export function assertNetwork(value: unknown): NetworkName {
  if (value === "preprod") return value;
  throw new UnsupportedNetworkError(value);
}

/**
 * Read the network from the environment at startup (CARDANO_NETWORK). Unset means preprod;
 * any other value makes startup fail.
 */
export function networkFromEnv(env: Record<string, string | undefined> = {}): NetworkName {
  const v = env.CARDANO_NETWORK;
  return v === undefined || v === "" ? DEFAULT_NETWORK : assertNetwork(v.trim().toLowerCase());
}

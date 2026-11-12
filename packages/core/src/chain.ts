import { BlockfrostProvider } from "@meshsdk/core";
import type { IFetcher, ISubmitter, Protocol } from "@meshsdk/core";
import { castProtocol } from "@meshsdk/common";
import { NETWORKS, assertNetwork, type NetworkName } from "./networks";
import { KoiosClient, type AssetBalance, type ChainTip, type TxSummary } from "./koios";
import { KoiosFetcher } from "./koiosProvider";
import { BlockfrostClient } from "./blockfrost";
import type { Registration } from "./registration";

/** Mọi nguồn dữ liệu chuỗi (Koios, Blockfrost/proxy) đều tuân theo giao diện này. */
export interface ChainClient {
  /** Current preprod chain tip */
  getTip(): Promise<ChainTip>;
  getBalance(addresses: string[]): Promise<AssetBalance[]>;
  getHistory(address: string, limit?: number): Promise<TxSummary[]>;
  getProtocolParams(): Promise<Protocol>;
  /** CIP-0146: tìm đăng ký multisig có chứa các key credential này (cũ nhất trước) */
  findRegistrations(credentials: string[]): Promise<Registration[]>;
  /** Giao dịch đã có trên chuỗi chưa? (dùng để nhận ra giao dịch đã được gửi trước đó) */
  txExists(txHash: string): Promise<boolean>;
}

export interface Providers {
  fetcher: IFetcher;
  submitter: ISubmitter;
  chain: ChainClient;
}
export type ProviderFactory = (network: NetworkName, settings: ProviderSettings) => Providers;

/** Data source settings. Public Koios by default; optional Blockfrost preprod through the proxy (the API key lives in the proxy, read from an environment variable). */
export interface ProviderSettings {
  /** Ví dụ https://wallet-proxy.example.com — proxy sẽ nhận /{mạng}/api/v0/... */
  proxyUrl?: string;
  /** true: use Blockfrost (preprod) through the proxy instead of Koios */
  proxyForTestnets?: boolean;
  /** true: testnet gọi Koios qua proxy của mình (bản web: Koios không có CORS cho POST) */
  koiosViaProxy?: boolean;
}

export class ProviderError extends Error {}

export const defaultProviders: ProviderFactory = (network, settings) => {
  const cfg = NETWORKS[assertNetwork(network)];
  if (settings.proxyForTestnets && settings.proxyUrl) {
    const base = `${settings.proxyUrl.replace(/\/+$/, "")}/${cfg.proxyPath}/api/v0`;
    const bf = new BlockfrostProvider(base);
    return { fetcher: bf, submitter: bf, chain: new BlockfrostClient(base, async () => castProtocol(await bf.fetchProtocolParameters() as any)) };
  }
  const direct = cfg.defaultProvider.url;
  const url = settings.koiosViaProxy && settings.proxyUrl ? `${settings.proxyUrl.replace(/\/+$/, "")}/koios/${cfg.proxyPath}/api/v1` : direct;
  const chain = new KoiosClient(network, undefined, url);
  const k = new KoiosFetcher(url, () => chain.getProtocolParams());
  return { fetcher: k as never, submitter: k as never, chain };
};

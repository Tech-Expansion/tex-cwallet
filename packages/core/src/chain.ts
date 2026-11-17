import type { IFetcher, ISubmitter, Protocol } from "@meshsdk/core";
import { NETWORKS, assertNetwork, type NetworkName } from "./networks";
import { KoiosClient, type AssetBalance, type ChainTip, type TxSummary } from "./koios";
import { KoiosFetcher } from "./koiosProvider";
import type { Registration } from "./registration";
import type { HistorySource } from "./history";
import type { HandleSource } from "./contacts";
import type { NftMetadataSource } from "./nft";
import type { AccountAddressSource } from "./xpub";
import type { StakeSource } from "./staking";

/** Mọi nguồn dữ liệu chuỗi đều tuân theo giao diện này (hiện chỉ có Koios). */
export interface ChainClient extends HistorySource, HandleSource, NftMetadataSource, AccountAddressSource, StakeSource {
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
export type ProviderFactory = (network: NetworkName) => Providers;

export class ProviderError extends Error {}

/** Public Koios for the network, no API key (ADR 0001). */
export const defaultProviders: ProviderFactory = (network) => {
  const url = NETWORKS[assertNetwork(network)].defaultProvider.url;
  const chain = new KoiosClient(network, undefined, url);
  const k = new KoiosFetcher(url, () => chain.getProtocolParams());
  return { fetcher: k as never, submitter: k as never, chain };
};

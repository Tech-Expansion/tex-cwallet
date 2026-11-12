export type NetworkName = "preview" | "preprod" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  label: string;
  /** 0 = testnet, 1 = mainnet (Cardano network id) */
  networkId: 0 | 1;
  /** Địa chỉ base bắt đầu bằng tiền tố này */
  addressPrefix: "addr_test1" | "addr1";
  /** Mạng có tiền thật: giao diện cảnh báo, mặc định bị khóa */
  realFunds: boolean;
  /** Đơn vị hiển thị */
  unit: "ADA" | "tADA";
  /** Nguồn dữ liệu mặc định. Mainnet không có mặc định công khai: cần proxy của bạn. */
  defaultProvider: { kind: "koios"; url: string } | { kind: "blockfrost-proxy" };
  /** Tên mạng trong đường dẫn của proxy / Blockfrost */
  proxyPath: string;
  explorerTxUrl: string;
  faucetUrl?: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  preview: {
    name: "preview", label: "Preview", networkId: 0, addressPrefix: "addr_test1", realFunds: false, unit: "tADA",
    defaultProvider: { kind: "koios", url: "https://preview.koios.rest/api/v1" }, proxyPath: "preview",
    explorerTxUrl: "https://preview.cardanoscan.io/transaction/",
    faucetUrl: "https://docs.cardano.org/cardano-testnets/tools/faucet",
  },
  preprod: {
    name: "preprod", label: "Preprod", networkId: 0, addressPrefix: "addr_test1", realFunds: false, unit: "tADA",
    defaultProvider: { kind: "koios", url: "https://preprod.koios.rest/api/v1" }, proxyPath: "preprod",
    explorerTxUrl: "https://preprod.cardanoscan.io/transaction/",
    faucetUrl: "https://docs.cardano.org/cardano-testnets/tools/faucet",
  },
  mainnet: {
    name: "mainnet", label: "Mainnet", networkId: 1, addressPrefix: "addr1", realFunds: true, unit: "ADA",
    defaultProvider: { kind: "blockfrost-proxy" }, proxyPath: "mainnet",
    explorerTxUrl: "https://cardanoscan.io/transaction/",
  },
};

export const DEFAULT_NETWORK: NetworkName = "preprod";
export const NETWORK_NAMES = Object.keys(NETWORKS) as NetworkName[];

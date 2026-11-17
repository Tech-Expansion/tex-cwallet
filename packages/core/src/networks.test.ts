import { describe, it, expect, beforeEach } from "vitest";
import {
  WalletManager, MemoryStore, NETWORKS, NETWORK_NAMES, KoiosClient, defaultProviders,
  assertNetwork, networkFromEnv, UnsupportedNetworkError, type ProviderFactory, type ChainClient,
} from "./index";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct-horse";
const TIP = { hash: "b".repeat(64), epoch: 180, slot: 77_000_000, blockHeight: 3_000_000, blockTime: 1_762_000_000 };

/** Fake chain: tests need no network (AI-2 AC-002). */
export const fakeChain = (over: Partial<ChainClient> = {}): ChainClient => ({
  getTip: async () => TIP,
  getBalance: async () => [],
  getHistory: async () => [],
  listAddressTxs: async () => [],
  getTxs: async () => [],
  assetAddresses: async () => [],
  getNftMetadata: async () => ({}),
  accountAddresses: async () => [],
  getStakeAccount: async () => ({ registered: false, rewards: 0n }),
  searchPools: async () => [],
  getProtocolParams: async () => { throw new Error("no params"); },
  findRegistrations: async () => [],
  txExists: async () => false,
  ...over,
});

describe("AI-2: chỉ preprod", () => {
  it("registry chỉ có preprod, network id 0, tiền tố addr_test1", () => {
    expect(Object.keys(NETWORKS)).toEqual(["preprod"]);
    expect(NETWORK_NAMES).toEqual(["preprod"]);
    expect(NETWORKS.preprod).toMatchObject({ networkId: 0, addressPrefix: "addr_test1", unit: "tADA" });
  });

  it("AC-003: mạng khác preprod bị từ chối", () => {
    for (const bad of ["mainnet", "preview", "Mainnet", "", undefined, 1, null])
      expect(() => assertNetwork(bad)).toThrow(UnsupportedNetworkError);
    expect(assertNetwork("preprod")).toBe("preprod");
    expect(() => defaultProviders("mainnet" as never)).toThrow(UnsupportedNetworkError);
  });

  it("AC-003: biến môi trường CARDANO_NETWORK khác preprod làm khởi động thất bại", () => {
    expect(networkFromEnv({})).toBe("preprod");
    expect(networkFromEnv({ CARDANO_NETWORK: "preprod" })).toBe("preprod");
    expect(networkFromEnv({ CARDANO_NETWORK: " PREPROD " })).toBe("preprod");
    expect(() => networkFromEnv({ CARDANO_NETWORK: "mainnet" })).toThrow(/chỉ chạy trên preprod/);
    expect(() => networkFromEnv({ CARDANO_NETWORK: "preview" })).toThrow(UnsupportedNetworkError);
  });

  it("AC-003: state đã lưu với mạng khác preprod bị từ chối khi load", async () => {
    for (const network of ["mainnet", "preview"]) {
      const store = new MemoryStore();
      await store.set("wallet-state-v1", { wallets: [], activeAccount: 0, network });
      await expect(new WalletManager(store).load()).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    }
  });

  describe("với ví đã mở", () => {
    let m: WalletManager;
    const fake: ProviderFactory = () => ({
      fetcher: { fetchAddressUTxOs: async () => [] } as any,
      submitter: { submitTx: async () => "f".repeat(64) } as any,
      chain: fakeChain(),
    });
    beforeEach(async () => {
      m = new WalletManager(new MemoryStore(), fake);
      await m.setupPassword(PW);
      await m.addWallet("A", M);
    });

    it("setNetwork chỉ nhận preprod", async () => {
      await expect(m.setNetwork("mainnet")).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
      await expect(m.setNetwork("preview")).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
      await m.setNetwork("preprod");
      expect(m.network).toBe("preprod");
    });

    it("AC-002: đọc tip qua interface (bản fake)", async () => {
      expect(await m.getTip()).toEqual(TIP);
    });

    it("địa chỉ ví là addr_test1…", async () => {
      expect((await m.getAccount()).baseAddress.startsWith("addr_test1")).toBe(true);
    });

  });

  it("nguồn dữ liệu: Koios preprod công khai", () => {
    expect(defaultProviders("preprod").chain).toBeInstanceOf(KoiosClient);
  });
});

describe("getTip trên client thật (fetch giả)", () => {
  const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
  it("Koios /tip", async () => {
    const f = (async (url: string) => {
      expect(url).toBe("https://k/api/v1/tip");
      return j([{ hash: TIP.hash, epoch_no: 180, abs_slot: 77_000_000, block_no: 3_000_000, block_time: 1_762_000_000 }]);
    }) as never;
    expect(await new KoiosClient("preprod", f, "https://k/api/v1").getTip()).toEqual(TIP);
  });
});

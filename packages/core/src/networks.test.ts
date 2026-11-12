import { describe, it, expect, beforeEach } from "vitest";
import {
  WalletManager, MemoryStore, NETWORKS, NETWORK_NAMES, BlockfrostClient, KoiosClient, defaultProviders,
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
    expect(() => defaultProviders("mainnet" as never, {})).toThrow(UnsupportedNetworkError);
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

    it("URL proxy phải hợp lệ", async () => {
      await expect(m.setProviderSettings({ proxyUrl: "not a url" })).rejects.toThrow(/URL/);
      await m.setProviderSettings({ proxyUrl: "https://p.example.com" });
      expect(m.providerSettings.proxyUrl).toBe("https://p.example.com");
    });
  });

  it("chọn nguồn dữ liệu: Koios mặc định, Blockfrost preprod qua proxy nếu bật", () => {
    expect(defaultProviders("preprod", {}).chain).toBeInstanceOf(KoiosClient);
    expect(defaultProviders("preprod", { proxyUrl: "https://p.example.com", proxyForTestnets: true }).chain).toBeInstanceOf(BlockfrostClient);
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
  it("Blockfrost /blocks/latest", async () => {
    const f = (async (url: string) => {
      expect(url).toBe("https://p/api/v0/blocks/latest");
      return j({ hash: TIP.hash, epoch: 180, slot: 77_000_000, height: 3_000_000, time: 1_762_000_000 });
    }) as never;
    expect(await new BlockfrostClient("https://p/api/v0", async () => ({}) as never, f).getTip()).toEqual(TIP);
  });
});

describe("BlockfrostClient", () => {
  const ADDR = "addr_test1qxyz";
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url.replace("https://p/api/v0", ""));
    const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (url.endsWith(`/addresses/${ADDR}`)) return j({ amount: [{ unit: "lovelace", quantity: "7000000" }, { unit: "abcd", quantity: "3" }] });
    if (url.includes(`/addresses/${ADDR}/transactions`)) return j([{ tx_hash: "t1", block_time: 20 }, { tx_hash: "t2", block_time: 10 }]);
    if (url.endsWith("/txs/t1/utxos")) return j({ inputs: [], outputs: [{ address: ADDR, amount: [{ unit: "lovelace", quantity: "5000000" }] }] });
    if (url.endsWith("/txs/t2/utxos")) return j({ inputs: [{ address: ADDR, amount: [{ unit: "lovelace", quantity: "2000000" }] }], outputs: [] });
    if (url.endsWith("/addresses/addr_test1new")) return j({}, 404);
    if (url.endsWith("/addresses/addr_test1full")) return j({}, 402);
    return j({}, 500);
  }) as any;
  const c = new BlockfrostClient("https://p/api/v0", async () => ({}) as any, f);

  it("số dư = 1 request, gồm token", async () => {
    calls.length = 0;
    expect(await c.getBalance([ADDR])).toEqual([{ unit: "lovelace", quantity: "7000000" }, { unit: "abcd", quantity: "3" }]);
    expect(calls).toHaveLength(1);
  });
  it("lịch sử = 1 + N request, tính net đúng", async () => {
    calls.length = 0;
    const h = await c.getHistory(ADDR, 2);
    expect(h.map((t) => [t.hash, t.netLovelace])).toEqual([["t1", 5000000n], ["t2", -2000000n]]);
    expect(calls).toHaveLength(3);
  });
  it("địa chỉ mới (404) = số dư rỗng; 402 báo hết hạn mức", async () => {
    expect(await c.getBalance(["addr_test1new"])).toEqual([]);
    await expect(c.getBalance(["addr_test1full"])).rejects.toThrow(/hết hạn mức/);
  });
});

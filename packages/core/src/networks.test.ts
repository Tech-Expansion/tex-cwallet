import { describe, it, expect, beforeEach } from "vitest";
import { WalletManager, MemoryStore, NETWORKS, BlockfrostClient, KoiosClient, defaultProviders, type ProviderFactory } from "./index";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct-horse";

describe("registry mạng", () => {
  it("3 mạng, chỉ mainnet có tiền thật và network id 1", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["mainnet", "preprod", "preview"]);
    expect(NETWORKS.mainnet).toMatchObject({ networkId: 1, addressPrefix: "addr1", realFunds: true, unit: "ADA" });
    expect(NETWORKS.preprod).toMatchObject({ networkId: 0, addressPrefix: "addr_test1", realFunds: false });
    expect(NETWORKS.preview.realFunds).toBe(false);
  });
});

describe("mainnet", () => {
  let m: WalletManager;
  const fake: ProviderFactory = (n) => ({
    fetcher: { fetchAddressUTxOs: async (address: string) => [{ input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: "50000000" }] } }] } as any,
    submitter: { submitTx: async () => "f".repeat(64) } as any,
    chain: { getBalance: async () => [], getHistory: async () => [], getProtocolParams: async () => { throw new Error("no params"); }, findRegistrations: async () => [], txExists: async () => false },
  });
  beforeEach(async () => {
    m = new WalletManager(new MemoryStore(), fake);
    await m.setupPassword(PW);
    await m.addWallet("A", M);
  });

  it("bị khóa mặc định; bật rồi mới chuyển được; tắt thì quay về mạng mặc định", async () => {
    await expect(m.setNetwork("mainnet")).rejects.toMatchObject({ code: "MAINNET_DISABLED" });
    await m.setMainnetEnabled(true);
    await m.setNetwork("mainnet");
    expect(m.network).toBe("mainnet");
    await m.setMainnetEnabled(false);
    expect(m.network).toBe("preprod");
  });

  it("địa chỉ mainnet là addr1…, khác testnet; mnemonic dùng chung", async () => {
    const test = (await m.getAccount()).baseAddress;
    await m.setMainnetEnabled(true);
    await m.setNetwork("mainnet");
    const main = (await m.getAccount()).baseAddress;
    expect(test.startsWith("addr_test1")).toBe(true);
    expect(main.startsWith("addr1")).toBe(true);
    // preview và preprod cùng địa chỉ
    await m.setNetwork("preview");
    expect((await m.getAccount()).baseAddress).toBe(test);
  });

  it("chặn gửi nhầm mạng (testnet ↔ mainnet)", async () => {
    const testAddr = (await m.getAccount()).baseAddress;
    await m.setMainnetEnabled(true);
    await m.setNetwork("mainnet");
    const mainAddr = (await m.getAccount()).baseAddress;
    await expect(m.sendAda(testAddr, 2_000_000n)).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await m.setNetwork("preprod");
    await expect(m.sendAda(mainAddr, 2_000_000n)).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });

  it("mainnet không được ký khi thiếu tham số giao thức; testnet vẫn gửi được", async () => {
    const to = (await m.getAccount()).baseAddress;
    expect(await m.sendAda(to, 2_000_000n)).toHaveLength(64); // preprod, params lỗi -> mặc định
    await m.setMainnetEnabled(true);
    await m.setNetwork("mainnet");
    const mainTo = (await m.getAccount()).baseAddress;
    await expect(m.sendAda(mainTo, 2_000_000n)).rejects.toThrow(/tham số giao thức/);
  });

  it("mainnet không có proxy thì báo lỗi rõ ràng; có proxy thì dựng được provider", () => {
    expect(() => defaultProviders("mainnet", {})).toThrow(/proxy/);
    expect(defaultProviders("mainnet", { proxyUrl: "https://p.example.com/" }).chain).toBeInstanceOf(BlockfrostClient);
    expect(defaultProviders("preprod", {}).chain).toBeInstanceOf(KoiosClient);
    expect(defaultProviders("preprod", { proxyUrl: "https://p.example.com", proxyForTestnets: true }).chain).toBeInstanceOf(BlockfrostClient);
  });

  it("URL proxy phải hợp lệ", async () => {
    await expect(m.setProviderSettings({ proxyUrl: "not a url" })).rejects.toThrow(/URL/);
    await m.setProviderSettings({ proxyUrl: "https://p.example.com" });
    expect(m.providerSettings.proxyUrl).toBe("https://p.example.com");
  });
});

describe("BlockfrostClient", () => {
  const ADDR = "addr1qxyz";
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url.replace("https://p/api/v0", ""));
    const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (url.endsWith(`/addresses/${ADDR}`)) return j({ amount: [{ unit: "lovelace", quantity: "7000000" }, { unit: "abcd", quantity: "3" }] });
    if (url.includes(`/addresses/${ADDR}/transactions`)) return j([{ tx_hash: "t1", block_time: 20 }, { tx_hash: "t2", block_time: 10 }]);
    if (url.endsWith("/txs/t1/utxos")) return j({ inputs: [], outputs: [{ address: ADDR, amount: [{ unit: "lovelace", quantity: "5000000" }] }] });
    if (url.endsWith("/txs/t2/utxos")) return j({ inputs: [{ address: ADDR, amount: [{ unit: "lovelace", quantity: "2000000" }] }], outputs: [] });
    if (url.endsWith("/addresses/addr1new")) return j({}, 404);
    if (url.endsWith("/addresses/addr1full")) return j({}, 402);
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
    expect(await c.getBalance(["addr1new"])).toEqual([]);
    await expect(c.getBalance(["addr1full"])).rejects.toThrow(/hết hạn mức/);
  });
});

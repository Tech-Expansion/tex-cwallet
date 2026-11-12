import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { MemoryStore, KoiosClient, type ProviderFactory } from "@wallet/core";
import { WalletApi, AUTO_LOCK_MS, type SessionStore } from "./api";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct-horse";

const providers: ProviderFactory = (n) => ({
  fetcher: { fetchAddressUTxOs: async (address: string) => [{ input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: "50000000" }] } }] } as any,
  submitter: { submitTx: async () => "f".repeat(64) } as any,
  chain: Object.assign(new KoiosClient(n, (async () => ({ ok: true, status: 200, json: async () => [] })) as any), {
    getProtocolParams: async () => DEFAULT_PROTOCOL_PARAMETERS,
    getTip: async () => ({ hash: "b".repeat(64), epoch: 180, slot: 1_000, blockHeight: 1, blockTime: 0 }),
  }),
});

function makeSession(): SessionStore & { data: any } {
  const s: any = { data: {}, get: async () => structuredClone(s.data), set: async (v: any) => { s.data = structuredClone(v); } };
  return s;
}

let store: MemoryStore, session: ReturnType<typeof makeSession>, now: number, api: WalletApi;
const mk = () => new WalletApi(store, session, providers, () => now);
beforeEach(() => { store = new MemoryStore(); session = makeSession(); now = 1_000_000; api = mk(); });

describe("WalletApi", () => {
  it("luồng cơ bản: state → setup → thêm ví → số dư", async () => {
    expect(await api.handle({ type: "state" })).toMatchObject({ hasVault: false, unlocked: false });
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    const st: any = await api.handle({ type: "state" });
    expect(st.unlocked).toBe(true);
    expect(st.wallets).toHaveLength(1);
    expect(st.wallets[0].vault).toBeUndefined();
    expect(await api.handle({ type: "balance" })).toEqual([]);
    expect(await api.handle({ type: "walletBalance" })).toEqual({ lovelace: "0", ada: "0.000000", assets: [] });
  });

  it("thao tác khi khóa bị từ chối; không lộ ví trong state", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    await api.handle({ type: "lock" });
    await expect(api.handle({ type: "balance" })).rejects.toMatchObject({ code: "LOCKED" });
    expect(((await api.handle({ type: "state" })) as any).wallets).toEqual([]);
    await expect(api.handle({ type: "unlock", password: "sai-mat-khau" })).rejects.toMatchObject({ code: "BAD_PASSWORD" });
  });

  it("service worker khởi động lại vẫn mở khóa nhờ session, hết hạn thì tự khóa", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    const api2 = mk(); // SW mới, RAM trống
    expect(((await api2.handle({ type: "state" })) as any).unlocked).toBe(true);
    now += AUTO_LOCK_MS + 1;
    const api3 = mk();
    expect(((await api3.handle({ type: "state" })) as any).unlocked).toBe(false);
    expect(session.data).toEqual({});
  });

  it("hoạt động làm mới bộ đếm tự khóa", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    now += AUTO_LOCK_MS - 1000;
    await api.handle({ type: "account" });
    now += AUTO_LOCK_MS - 1000;
    expect(((await mk().handle({ type: "state" })) as any).unlocked).toBe(true);
  });

  it("CIP-30: chưa enable thì bị chặn; enable cần phê duyệt", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    await expect(api.dapp("https://x.io", "getUtxos")).rejects.toMatchObject({ code: "LOCKED" });
    let seen: any;
    api.onApprovalNeeded = (a) => { seen = a; void api.handle({ type: "resolveApproval", id: a.id, ok: false }); };
    await expect(api.dapp("https://x.io", "enable")).rejects.toThrow(/từ chối/);
    expect(seen.kind).toBe("enable");
    expect(await api.dapp("https://x.io", "isEnabled")).toBe(false);

    api.onApprovalNeeded = (a) => void api.handle({ type: "resolveApproval", id: a.id, ok: true });
    expect(await api.dapp("https://x.io", "enable")).toBe(true);
    expect(await api.dapp("https://x.io", "isEnabled")).toBe(true);
    expect(await api.dapp("https://x.io", "getNetworkId")).toBe(0);
    expect(await api.dapp("https://x.io", "getUtxos")).toHaveLength(1);
    // origin khác không được hưởng quyền
    await expect(api.dapp("https://evil.io", "getUtxos")).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("CIP-30: signTx hiện bản tóm tắt và chỉ ký khi chấp nhận", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    api.onApprovalNeeded = (a) => void api.handle({ type: "resolveApproval", id: a.id, ok: true });
    await api.dapp("https://x.io", "enable");
    const { signedTx } = await api.manager.buildSendAda((await api.manager.deriveFor(M)).baseAddress, 2_000_000n);

    let detail = "";
    api.onApprovalNeeded = (a) => { detail = a.detail ?? ""; void api.handle({ type: "resolveApproval", id: a.id, ok: false }); };
    await expect(api.dapp("https://x.io", "signTx", [signedTx, false])).rejects.toThrow(/từ chối/);
    expect(detail).toContain("2.000000 ADA");

    api.onApprovalNeeded = (a) => void api.handle({ type: "resolveApproval", id: a.id, ok: true });
    expect(await api.dapp("https://x.io", "signTx", [signedTx, true])).toMatch(/^[0-9a-f]+$/);
  });

  it("đổi ví/mạng hoặc khóa sẽ ngắt kết nối dApp", async () => {
    await api.handle({ type: "setup", password: PW });
    const w: any = await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    api.onApprovalNeeded = (a) => void api.handle({ type: "resolveApproval", id: a.id, ok: true });
    await api.dapp("https://x.io", "enable");
    await expect(api.handle({ type: "setNetwork", network: "preview" as never })).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    await api.handle({ type: "setActive", walletId: w.id, account: 0 });
    expect(await api.dapp("https://x.io", "isEnabled")).toBe(false);
  });

  it("gửi ADA: xem trước (số tiền, phí, người nhận) rồi mới ký, ký cần nhập lại mật khẩu", async () => {
    await api.handle({ type: "setup", password: PW });
    await api.handle({ type: "addWallet", name: "A", mnemonic: M });
    const to = (await api.manager.deriveFor(M)).baseAddress;
    const p: any = await api.handle({ type: "prepareSend", to, lovelace: "2000000" });
    expect(p).toMatchObject({ to, lovelace: "2000000" });
    expect(BigInt(p.fee) > 0n).toBe(true);
    expect(BigInt(p.totalLovelace)).toBe(2_000_000n + BigInt(p.fee));
    await expect(api.handle({ type: "prepareSend", to, lovelace: "1.5" })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(api.handle({ type: "confirmSend", txHash: p.txHash, password: "sai-mat-khau" })).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    expect(await api.handle({ type: "confirmSend", txHash: p.txHash, password: PW })).toHaveLength(64);
  });
});

describe("WalletApi – chỉ preprod", () => {
  it("state chỉ có preprod; mạng khác bị từ chối; proxy Blockfrost preprod tuỳ chọn", async () => {
    const store = new MemoryStore();
    const a = new WalletApi(store, makeSession(), providers, () => 1);
    await a.handle({ type: "setup", password: PW });
    await a.handle({ type: "addWallet", name: "A", mnemonic: M });
    const st: any = await a.handle({ type: "state" });
    expect(st.network).toBe("preprod");
    expect(st.networks.map((n: any) => n.name)).toEqual(["preprod"]);
    expect(st.networks[0]).toMatchObject({ unit: "tADA", addressPrefix: "addr_test1" });
    expect(st.mainnetEnabled).toBeUndefined();
    await expect(a.handle({ type: "setNetwork", network: "mainnet" as never })).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    await expect(a.handle({ type: "setMainnet", enabled: true } as never)).rejects.toThrow();
    expect(((await a.handle({ type: "account" })) as any).baseAddress.startsWith("addr_test1")).toBe(true);
    await a.handle({ type: "setProvider", proxyUrl: " https://p.example.com ", proxyForTestnets: true });
    expect(((await a.handle({ type: "state" })) as any).provider).toEqual({ proxyUrl: "https://p.example.com", proxyForTestnets: true });
  });
});

describe("WalletApi – multisig", () => {
  it("tạo ví → xuất → nhập ở người khác; đề xuất cần mật khẩu; ký/gửi qua API", async () => {
    const mk2 = async (m: string) => {
      const a = new WalletApi(new MemoryStore(), makeSession(), providers, () => 1);
      await a.handle({ type: "setup", password: PW });
      await a.handle({ type: "addWallet", name: "U", mnemonic: m });
      return a;
    };
    const A = await mk2(M);
    const B = await mk2("legal winner thank year wave sausage worth useful legal winner thank yellow");
    const kb = ((await B.handle({ type: "sharedKey", y: 0 })) as any).keyHash;
    expect(kb).toMatch(/^[0-9a-f]{56}$/);
    expect(await A.handle({ type: "sharedCheckKey", input: kb.toUpperCase() })).toBe(kb);
    await expect(A.handle({ type: "sharedCheckKey", input: "ab".repeat(64) })).rejects.toThrow(/bí mật/);
    const preview: any = await A.handle({ type: "sharedPreview", required: 2, cosigners: [{ name: "B", keyHash: kb }] });
    const w: any = await A.handle({ type: "sharedCreate", name: "Quỹ", required: 2, cosigners: [{ name: "B", keyHash: kb }], myIndex: preview.myIndex });
    expect(w.address).toBe(preview.address);
    expect(((await A.handle({ type: "sharedList" })) as any[]).length).toBe(1);
    const exported = (await A.handle({ type: "sharedExport", id: w.id })) as string;
    const wb: any = await B.handle({ type: "sharedImport", input: exported });
    expect(wb.address).toBe(w.address);
    const to = (await A.manager.deriveFor(M)).baseAddress;
    await expect(A.handle({ type: "sharedPropose", id: w.id, to, lovelace: "3000000", password: "sai-mat-khau" })).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    const req = (await A.handle({ type: "sharedPropose", id: w.id, to, lovelace: "3000000", memo: "thử", password: PW })) as string;
    const items: any[] = (await A.handle({ type: "sharedRequests", id: w.id })) as any[];
    expect(items[0].preview.signedBy.length).toBe(1);
    expect(items[0].memo).toBe("thử");
    expect(await B.handle({ type: "sharedDetect", input: req })).toEqual({ kind: "signRequest", walletId: w.id });
    expect(await B.handle({ type: "sharedDetect", input: kb })).toEqual({ kind: "cosignerKey", keyHash: kb });
    expect(((await B.handle({ type: "sharedReceive", request: req })) as any).merged).toBe(false);
    const signed: any = await B.handle({ type: "sharedSign", request: req, password: PW });
    expect(signed.preview.enough).toBe(true);
    expect(await B.handle({ type: "sharedSubmit", request: signed.request })).toHaveLength(64);
    await A.handle({ type: "lock" });
    await expect(A.handle({ type: "sharedList" })).rejects.toMatchObject({ code: "LOCKED" });
  });
});

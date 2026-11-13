import { describe, it, expect, beforeEach } from "vitest";
import { WalletManager, MemoryStore, parseHandle, handleUnits, resolveHandle, HANDLE_POLICIES, CIP68_USER_LABEL, KoiosClient, BlockfrostClient, type ProviderFactory } from "./index";
import { Address } from "@meshsdk/core-cst";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct-horse";
const A1 = "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8dav6cmp4pmtv7cc3yel9uu0nq93swx9";
const A2 = "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";
const MAINNET = (() => {
  const hex = Address.fromBech32(A1 as never).toBytes() as string;
  return Address.fromBytes((((parseInt(hex.slice(0, 2), 16) & 0xf0) | 0x01).toString(16).padStart(2, "0") + hex.slice(2)) as never).toBech32();
})();
const P = HANDLE_POLICIES[0];

let holders: Record<string, string[]> = {};
const factory: ProviderFactory = () => ({ fetcher: {} as never, submitter: {} as never, chain: { assetAddresses: async (u: string) => holders[u] ?? [] } as never });
let store: MemoryStore, m: WalletManager;
beforeEach(async () => {
  holders = {};
  store = new MemoryStore();
  m = new WalletManager(store, factory);
  await m.setupPassword(PW);
  await m.addWallet("A", M);
});

describe("AI-22: sổ địa chỉ", () => {
  it("thêm / sửa / xoá, sắp theo tên, lưu cục bộ trong state", async () => {
    const b = await m.saveContact({ name: " Bình ", address: A2, note: "quỹ lớp" });
    const a = await m.saveContact({ name: "An", address: A1 });
    expect(m.listContacts().map((c) => c.name)).toEqual(["An", "Bình"]);
    expect(b).toMatchObject({ name: "Bình", address: A2, note: "quỹ lớp" });
    await m.saveContact({ id: b.id, name: "Bình 2", address: A2 });
    const edited = m.listContacts().find((c) => c.id === b.id)!;
    expect([edited.name, edited.note]).toEqual(["Bình 2", undefined]);
    await m.removeContact(a.id);
    expect(m.listContacts().map((c) => c.id)).toEqual([b.id]);
    const saved = (await store.get<any>("wallet-state-v1"))!;
    expect(saved.contacts).toHaveLength(1);
    // nạp lại từ store
    const m2 = new WalletManager(store, factory);
    await m2.unlock(PW);
    expect(m2.listContacts()[0]!.name).toBe("Bình 2");
    expect(MAINNET.startsWith("addr1")).toBe(true);
  });
  it("AC-004: từ chối địa chỉ mainnet / sai; trùng địa chỉ; tên rỗng; quá dài", async () => {
    await expect(m.saveContact({ name: "X", address: MAINNET })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.saveContact({ name: "X", address: "addr_test1xyz" })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.saveContact({ name: "  ", address: A1 })).rejects.toMatchObject({ code: "INVALID_CONTACT" });
    await expect(m.saveContact({ name: "x".repeat(41), address: A1 })).rejects.toMatchObject({ code: "INVALID_CONTACT" });
    await m.saveContact({ name: "An", address: A1 });
    await expect(m.saveContact({ name: "An 2", address: A1 })).rejects.toThrow(/đã có trong sổ: An/);
    await expect(m.removeContact("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("khi khoá không đọc/ghi được", async () => {
    m.lock();
    expect(() => m.listContacts()).toThrow(/khóa/);
    await expect(m.saveContact({ name: "An", address: A1 })).rejects.toMatchObject({ code: "LOCKED" });
  });
});

describe("AI-22: ADA Handle", () => {
  it("cú pháp: $ + 1–15 ký tự a-z0-9_.-, không phân biệt hoa thường; không nhận sub-handle", () => {
    expect(parseHandle("$Alice")).toBe("alice");
    expect(parseHandle(" $a_b.c-1 ")).toBe("a_b.c-1");
    for (const bad of ["alice", "$", "$" + "a".repeat(16), "$al ice", "$sub@root", "$ví"]) expect(parseHandle(bad)).toBeUndefined();
  });
  it("tìm cả token CIP-68 (000de140) và bản cũ CIP-25", () => {
    expect(handleUnits("ab")).toEqual([P + CIP68_USER_LABEL + "6162", P + "6162"]);
  });
  it("AC-003: trả địa chỉ preprod đang giữ handle", async () => {
    holders[P + "616c696365"] = [A1];
    expect(await m.resolveHandle("$alice")).toEqual({ handle: "$alice", address: A1, unit: P + "616c696365" });
    holders[P + CIP68_USER_LABEL + "626f62"] = [A2];
    expect((await m.resolveHandle("$BOB")).address).toBe(A2);
  });
  it("không tìm thấy / nhiều chủ / địa chỉ mainnet đều bị từ chối", async () => {
    await expect(m.resolveHandle("$ghost")).rejects.toMatchObject({ code: "HANDLE_NOT_FOUND" });
    holders[P + "6475"] = [A1, A2];
    await expect(m.resolveHandle("$du")).rejects.toThrow(/nhiều địa chỉ/);
    holders[P + "6d6e"] = [MAINNET];
    await expect(m.resolveHandle("$mn")).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(m.resolveHandle("alice")).rejects.toMatchObject({ code: "INVALID_HANDLE" });
  });
  it("Koios và Blockfrost: gọi đúng endpoint, bỏ số lượng 0, 404 = không có", async () => {
    const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    const urls: string[] = [];
    const k = new KoiosClient("preprod", (async (u: string) => (urls.push(u), j([{ payment_address: A1, quantity: "1" }, { payment_address: A2, quantity: "0" }]))) as never, "https://k/api/v1");
    expect(await k.assetAddresses(P + "6162")).toEqual([A1]);
    expect(urls[0]).toBe(`https://k/api/v1/asset_addresses?_asset_policy=${P}&_asset_name=6162`);
    const b = new BlockfrostClient("https://p/api/v0", async () => ({}) as never, (async (u: string) => (u.includes("6162") ? j([{ address: A2, quantity: "1" }]) : j({}, 404))) as never);
    expect(await b.assetAddresses(P + "6162")).toEqual([A2]);
    expect(await resolveHandle(b, "$ab", "preprod")).toMatchObject({ address: A2 });
    await expect(resolveHandle(b, "$zz", "preprod")).rejects.toMatchObject({ code: "HANDLE_NOT_FOUND" });
  });
});

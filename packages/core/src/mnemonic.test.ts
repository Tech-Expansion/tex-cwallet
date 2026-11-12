import { describe, it, expect } from "vitest";
import { WalletManager, MemoryStore, generateMnemonic, checkMnemonic, deriveAccount, normalizeMnemonic } from "./index";

/**
 * Public test vector, NEVER for real funds: the Mesh SDK 24-word demo mnemonic
 * ("solution" x24) and its testnet base address for account 0 / index 0 (CIP-1852),
 * as published in the Mesh / developers.cardano.org docs.
 */
const VECTOR_24 = Array(24).fill("solution") as string[];
const VECTOR_24_ADDR = "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8dav6cmp4pmtv7cc3yel9uu0nq93swx9";
const PW = "correct-horse";

async function manager(store = new MemoryStore()) {
  const m = new WalletManager(store);
  await m.load();
  if (m.hasVault()) await m.unlock(PW);
  else await m.setupPassword(PW);
  return m;
}

describe("AI-3: tạo / khôi phục ví từ mnemonic", () => {
  it("AC-001: tạo ví mới trả về 24 từ BIP-39 và địa chỉ nhận preprod", async () => {
    const m = await manager();
    const words = m.newMnemonic();
    expect(words).toHaveLength(24);
    expect(checkMnemonic(words)).toBeNull();
    expect(generateMnemonic()).not.toEqual(words); // random
    await m.addWallet("Mới", words);
    const addr = (await m.getAccount()).baseAddress;
    expect(addr).toMatch(/^addr_test1q[02-9ac-hj-np-z]+$/); // base address (key/key), preprod
  });

  it("AC-002: khôi phục khớp test vector công khai", async () => {
    expect((await deriveAccount(VECTOR_24, "preprod", 0)).baseAddress).toBe(VECTOR_24_ADDR);
    const m = await manager();
    await m.addWallet("Khôi phục", VECTOR_24.join("  ").toUpperCase()); // normalizes whitespace / case
    expect((await m.getAccount()).baseAddress).toBe(VECTOR_24_ADDR);
  });

  it("AC-002: tạo rồi khôi phục cùng mnemonic ở ví khác ra cùng địa chỉ", async () => {
    const a = await manager();
    const words = a.newMnemonic();
    await a.addWallet("A", words);
    const b = await manager();
    await b.addWallet("B", words.join(" "));
    expect((await b.getAccount()).baseAddress).toBe((await a.getAccount()).baseAddress);
  });

  it("AC-003: sai checksum bị từ chối với thông báo rõ ràng", async () => {
    const m = await manager();
    const badChecksum = Array(24).fill("abandon").join(" "); // valid words, bad checksum
    await expect(m.addWallet("x", badChecksum)).rejects.toMatchObject({ code: "INVALID_MNEMONIC", message: expect.stringMatching(/checksum/) });
    expect(checkMnemonic(normalizeMnemonic(badChecksum))).toEqual({ reason: "CHECKSUM" });
  });

  it("từ không có trong danh sách và sai số từ được báo riêng, không lặp lại mnemonic", async () => {
    const m = await manager();
    const words = [...VECTOR_24];
    words[4] = "xyzzyq";
    const err = await m.addWallet("x", words).catch((e) => e);
    expect(err).toMatchObject({ code: "INVALID_MNEMONIC" });
    expect(err.message).toMatch(/Từ thứ 5/);
    expect(err.message).not.toMatch(/solution|xyzzyq/);
    expect(checkMnemonic(VECTOR_24.slice(0, 23))).toEqual({ reason: "WORD_COUNT", count: 23 });
  });

  it("mnemonic không nằm ở dạng rõ trong storage", async () => {
    const store = new MemoryStore();
    const m = await manager(store);
    await m.addWallet("A", VECTOR_24);
    const raw = JSON.stringify(await store.get("wallet-state-v1"));
    expect(raw).not.toContain("solution");
    // reopening with the password gives the same address
    const again = await manager(store);
    expect((await again.getAccount()).baseAddress).toBe(VECTOR_24_ADDR);
  });
});

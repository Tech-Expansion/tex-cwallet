import { describe, it, expect } from "vitest";
import { encrypt, decrypt, generateMnemonic, validateMnemonic, deriveAccount } from "./index";

// Mnemonic test vector công khai (KHÔNG dùng cho tiền thật)
const TEST = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".split(" ");

describe("mnemonic", () => {
  it("sinh 24 từ hợp lệ", () => {
    const m = generateMnemonic(24);
    expect(m).toHaveLength(24);
    expect(validateMnemonic(m)).toBe(true);
  });
  it("từ chối mnemonic sai", () => {
    expect(validateMnemonic(["foo", "bar"])).toBe(false);
  });
});

describe("vault", () => {
  it("mã hóa/giải mã round-trip", async () => {
    const blob = await encrypt("secret words", "pw123456");
    expect(await decrypt(blob, "pw123456")).toBe("secret words");
  });
  it("sai mật khẩu thì lỗi", async () => {
    const blob = await encrypt("secret", "right-pw");
    await expect(decrypt(blob, "wrong-pw")).rejects.toThrow();
  });
});

describe("derive", () => {
  it("địa chỉ testnet bắt đầu bằng addr_test và ổn định", async () => {
    const a = await deriveAccount(TEST, "preprod", 0);
    expect(a.baseAddress.startsWith("addr_test1")).toBe(true);
    expect((await deriveAccount(TEST, "preprod", 0)).baseAddress).toBe(a.baseAddress);
    const c = await deriveAccount(TEST, "preprod", 1);
    expect(c.baseAddress).not.toBe(a.baseAddress);
  });
});

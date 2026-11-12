import { describe, it, expect } from "vitest";
import { Serialization, resolveTxHash } from "@meshsdk/core-cst";
import { sharedKeyHash, buildPaymentScript, makeSharedWallet, scriptHashOf } from "./shared";
import { buildRegistrationTx, parseRegistration, registrationMetadata, truncateMetadataString, fromParts, registrationHasKey } from "./registration";

const W = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
].map((m) => m.split(" "));
const MY = "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";
const utxo = { input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address: MY, amount: [{ unit: "lovelace", quantity: "50000000" }] } };

async function wallet() {
  const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
  return makeSharedWallet({ name: "Quỹ nhóm Việt", network: "preprod", paymentScript: buildPaymentScript(2, kh), signers: kh.map((k, i) => ({ keyHash: k, name: ["An", "Bình", "Chi"][i]! })) });
}

describe("đăng ký CIP-0146", () => {
  it("metadata đúng định dạng: types, name, participants theo key hash", async () => {
    const w = await wallet();
    const m = registrationMetadata(w);
    expect(m.types).toEqual([0]);
    expect(m.name).toBe("Quỹ nhóm Việt");
    expect(Object.keys(m.participants!).sort()).toEqual(w.signers.map((s) => s.keyHash).sort());
    expect(Object.values(m.participants!).map((p) => p.name).sort()).toEqual(["An", "Bình", "Chi"]);
  });

  it("giao dịch đăng ký: có metadata 1854 + native_scripts, hash aux đúng, phí đủ, đọc lại ra đúng ví", async () => {
    const w = await wallet();
    const tx = await buildRegistrationTx(w, [utxo], MY);
    const t = Serialization.Transaction.fromCbor(tx as never);
    expect(t.auxiliaryData()?.nativeScripts()?.length).toBe(1);
    expect(t.body().auxiliaryDataHash()).toBeTruthy();
    expect(BigInt(t.body().fee())).toBeGreaterThanOrEqual(BigInt(44 * (tx.length / 2 + 101) + 155381)); // đủ cho 1 chữ ký của người đăng ký
    const r = parseRegistration(tx)!;
    expect(r).toBeTruthy();
    expect(scriptHashOf(r.payment)).toBe(w.paymentScriptHash);
    expect(r.metadata.name).toBe("Quỹ nhóm Việt");
    expect(registrationHasKey(r, w.signers[0]!.keyHash)).toBe(true);
    expect(registrationHasKey(r, "00".repeat(28))).toBe(false);
    // ghép lại ví từ đăng ký cho cùng địa chỉ
    expect(makeSharedWallet({ name: "x", network: "preprod", paymentScript: r.payment }).address).toBe(w.address);
    expect(resolveTxHash(tx)).toHaveLength(64);
  });

  it("giao dịch thường (không có đăng ký) và dữ liệu hỏng trả null; types lệch độ dài / thiếu payment bị loại", async () => {
    expect(parseRegistration("84a0")).toBeNull();
    expect(parseRegistration("zz")).toBeNull();
    const w = await wallet();
    expect(fromParts({ types: [0] }, [w.paymentScript])).toBeTruthy();
    expect(fromParts({ types: [0, 2] }, [w.paymentScript])).toBeNull(); // lệch độ dài
    expect(fromParts({ types: [2] }, [w.paymentScript])).toBeNull(); // thiếu script thanh toán
    expect(fromParts({ types: [] }, [])).toBeNull();
    expect(fromParts(null, [w.paymentScript])).toBeNull();
  });

  it("chấp nhận dạng types kiểu cũ (chuỗi) và chuỗi bị chia đoạn; từ chối metadata mã hóa", async () => {
    const w = await wallet();
    const stake = buildPaymentScript(1, [w.signers[0]!.keyHash]);
    const r = fromParts({ types: ["payment", "stake"], name: ["Quỹ ", "nhóm"], participants: {} }, [w.paymentScript, stake])!;
    expect(r.metadata.types).toEqual([0, 2]);
    expect(r.metadata.name).toBe("Quỹ nhóm");
    expect(scriptHashOf(r.payment)).toBe(w.paymentScriptHash);
    expect(r.stake).toBeTruthy();
    expect(fromParts({ types: ["payment", "stake"] }, [stake, w.paymentScript])!.payment).toEqual(stake); // theo vị trí types
    expect(fromParts({ types: ["lạ"] }, [w.paymentScript])).toBeNull();
    expect(fromParts({ types: [0], enc: "basic", name: ["U2FsdGVk"] }, [w.paymentScript])).toBeNull();
  });

  it("cắt chuỗi metadata ≤ 64 byte, không vỡ UTF-8", () => {
    const s = truncateMetadataString("Quỹ ".repeat(40));
    expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(64);
    expect(s.includes("�")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_PROTOCOL_PARAMETERS } from "@meshsdk/common";
import { MeshTxBuilder } from "@meshsdk/core";
import { Address } from "@meshsdk/core-cst";
import { WalletManager, MemoryStore, inspectSignData, verifyDataSignature, looksLikeTransaction, payloadText } from "./index";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

async function wallet() {
  const m = new WalletManager(new MemoryStore(), () => ({ fetcher: {} as never, submitter: {} as never, chain: {} as never }));
  await m.setupPassword("correct-horse");
  await m.addWallet("A", M);
  return m;
}

describe("AI-26: duyệt signData", () => {
  it("AC-001: UTF-8 hiện chữ, nhị phân chỉ hex; địa chỉ hex đổi sang bech32", async () => {
    const m = await wallet();
    const [payHex] = await (await m.cip30()).getUsedAddresses();
    const v = inspectSignData(payHex!, hex("Đăng nhập example.io\nnonce: 42"));
    expect(v).toMatchObject({ address: (await m.getAccount()).baseAddress, text: "Đăng nhập example.io\nnonce: 42", looksLikeTx: false });
    expect(inspectSignData(payHex!, "00ff10").text).toBeUndefined();
    expect(payloadText(hex("abc\u0001"))).toBeUndefined();
    expect(() => inspectSignData(payHex!, "xyz")).toThrow(/hex/);
  });

  it("AC-002: payload là giao dịch hoặc thân giao dịch CBOR thì cảnh báo", async () => {
    const m = await wallet();
    const me = (await m.getAccount()).baseAddress;
    const b = new MeshTxBuilder({ params: DEFAULT_PROTOCOL_PARAMETERS });
    b.txIn("a".repeat(64), 0, [{ unit: "lovelace", quantity: "10000000" }], me, 0).txOut(me, [{ unit: "lovelace", quantity: "2000000" }]).changeAddress(me);
    const tx = await b.complete();
    expect(looksLikeTransaction(tx)).toBe(true);
    const { Serialization } = await import("@meshsdk/core-cst");
    expect(looksLikeTransaction(Serialization.Transaction.fromCbor(tx as never).body().toCbor())).toBe(true);
    expect(inspectSignData(me, tx).looksLikeTx).toBe(true);
    expect(looksLikeTransaction(hex("hello world, this is definitely not a transaction body"))).toBe(false);
  });

  it("AC-003: xác minh COSE_Sign1 + key: đúng payload/địa chỉ thì hợp lệ, sửa bất kỳ phần nào thì không", async () => {
    const m = await wallet();
    const api = await m.cip30();
    const [payHex] = await api.getUsedAddresses();
    const addr = Address.fromBytes(payHex as never).toBech32();
    const sig = await api.signData(payHex!, hex("xin chào"));
    expect(await verifyDataSignature({ payload: "xin chào", signature: sig.signature, key: sig.key, address: addr })).toBe(true);
    expect(await verifyDataSignature({ payload: hex("xin chào"), payloadIsHex: true, signature: sig.signature, key: sig.key })).toBe(true);
    expect(await verifyDataSignature({ payload: "xin chao", signature: sig.signature, key: sig.key, address: addr })).toBe(false);
    const other = (await m.deriveFor("legal winner thank year wave sausage worth useful legal winner thank yellow")).baseAddress;
    expect(await verifyDataSignature({ payload: "xin chào", signature: sig.signature, key: sig.key, address: other })).toBe(false);
    expect(await verifyDataSignature({ payload: "xin chào", signature: sig.signature.slice(0, -2) + "00", key: sig.key })).toBe(false);
    await expect(verifyDataSignature({ payload: "x", signature: "zz", key: sig.key })).rejects.toThrow(/hex/);
  });
});

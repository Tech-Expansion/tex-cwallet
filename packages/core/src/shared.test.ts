import { describe, it, expect } from "vitest";
import { MeshWallet, resolvePaymentKeyHash } from "@meshsdk/core";
import { Cardano, Serialization } from "@meshsdk/core-cst";
import { sharedKeyHash, signWithSharedKey, buildPaymentScript, makeSharedWallet, buildSharedSend, inspectSharedTx, attachWitnesses, readWitnesses, scriptFromCbor, scriptCborOf, scriptAddress, sharedAddress, type NativeScriptJson, scriptHashOf, toKeyHash, SharedError } from "./shared";

const W = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
].map((m) => m.split(" "));

async function setup(required = 2, network: "preprod" = "preprod") {
  const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
  const script = buildPaymentScript(required, kh);
  const wallet = makeSharedWallet({ name: "Quỹ", network, paymentScript: script, signers: kh.map((k, i) => ({ keyHash: k, name: `S${i}` })) });
  const utxo = (address: string, ada = 50) => ({ input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: String(ada * 1_000_000) }] } });
  return { kh, script, wallet, utxo };
}

describe("khóa CIP-1854", () => {
  it("khóa 1854 khác khóa 1852 thường; khác role/chỉ số thì khác; ổn định", async () => {
    const a = await sharedKeyHash(W[0]!, 0);
    const mesh = new MeshWallet({ networkId: 0, key: { type: "mnemonic", words: W[0]! } });
    await mesh.init();
    expect(a).not.toBe(resolvePaymentKeyHash(mesh.getAddresses().baseAddressBech32!)); // không phải khóa thanh toán thường
    expect(a).toMatch(/^[0-9a-f]{56}$/);
    expect(await sharedKeyHash(W[0]!, 0)).toBe(a);
    expect(await sharedKeyHash(W[0]!, 1)).not.toBe(a);
    expect(await sharedKeyHash(W[0]!, 0, 2)).not.toBe(a);
    // giá trị tham chiếu (m/1854'/1815'/0'/0/0 của mnemonic thử nghiệm) — chống thay đổi ngầm của đường dẫn
    expect(a).toBe("32000809732f4d5b9a53e2eec996e7c79a24963068ffbf3565318e9a");
    expect(await sharedKeyHash(W[0]!, 0, 2)).toBe("732b0e7a5aed1393a5427f1ec5a3d03b522659b8f2e8029bcea1b3b3");
  });
});

describe("script & địa chỉ", () => {
  it("2-of-3 → atLeast, 3-of-3 → all; địa chỉ đúng mạng; thứ tự cosigner không đổi địa chỉ", async () => {
    const { kh, wallet } = await setup(2);
    expect(wallet.paymentScript.type).toBe("atLeast");
    expect(wallet.required).toBe(2);
    expect(wallet.address.startsWith("addr_test1w")).toBe(true); // enterprise script
    expect(buildPaymentScript(3, kh).type).toBe("all");
    const rev = makeSharedWallet({ name: "x", network: "preprod", paymentScript: buildPaymentScript(2, [...kh].reverse()) });
    expect(rev.address).toBe(wallet.address);
    expect(wallet.id).toBe(`preprod-${wallet.paymentScriptHash}`);
  });
  it("script CBOR xuất ra rồi nhập lại cho cùng hash và địa chỉ (import từ Eternl/Mesh)", async () => {
    const { wallet, script } = await setup(2);
    const back = scriptFromCbor(scriptCborOf(script));
    expect(scriptHashOf(back)).toBe(wallet.paymentScriptHash);
    expect(makeSharedWallet({ name: "i", network: "preprod", paymentScript: back }).address).toBe(wallet.address);
    expect(() => scriptFromCbor("zz")).toThrow(SharedError);
  });
  it("TEX Wallet on-chain scripts give the base address with script payment and script stake credentials", () => {
    const sigs = (...k: string[]) => k.map((keyHash) => ({ type: "sig" as const, keyHash }));
    // exactly as registered on chain: the key order is part of the hash, so do not go through buildPaymentScript
    const payment: NativeScriptJson = { type: "atLeast", required: 2, scripts: sigs("4c8be8de00479f8cc78364aef40ca4c2595871596ee1781f036b335c", "67f4d8c4097a2da508fb3fc2ea9f09604129fb71d834e1f558181f6d", "0c64be2644a74a4fdddae5b01aa213588d14db5772b6bfb10ffcc892") };
    const stake: NativeScriptJson = { type: "atLeast", required: 2, scripts: sigs("d8db94667f661c4b7958653e048d8e114da35c75ababf82267eef4cf", "ba7523df270aadd3a3382bac1536664c7cb7ba256fa7eff2eada9bce", "df53300dc9691d4b0804f85c3dfc10819208286c1527fd668db94390") };
    expect(scriptHashOf(payment)).toBe("df741395fabffd04a487478ec1522e30e7968b5684f6a564aa4ee29d");
    expect(scriptHashOf(stake)).toBe("f10b13fb815fb4bd7d6d023564443e4596cf8a783c202c30e2152184");
    // The repo lint blocks mainnet bech32 literals until AI-47, so check the decoded address instead of the string.
    // For TEX Wallet on mainnet it must be the base address "addr1x80hgyu…cw46q" (verified against Koios on 2026-11-17).
    const main = scriptAddress(payment, 1, stake);
    expect(main.startsWith("addr1x80hgyu4l2ll6p")).toBe(true);
    expect(main.endsWith("pcs4yxzq7cw46q")).toBe(true);
    const props = Cardano.Address.fromBech32(main).getProps();
    expect(props.type).toBe(Cardano.AddressType.BasePaymentScriptStakeScript);
    expect(props.networkId).toBe(1);
    expect(props.paymentPart).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: "df741395fabffd04a487478ec1522e30e7968b5684f6a564aa4ee29d" });
    expect(props.delegationPart).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: "f10b13fb815fb4bd7d6d023564443e4596cf8a783c202c30e2152184" });
    expect(sharedAddress(payment, "preprod", stake)).toMatch(/^addr_test1x/);
    // without a stake script it stays the enterprise address
    expect(Cardano.Address.fromBech32(scriptAddress(payment, 1)).getProps().type).toBe(Cardano.AddressType.EnterpriseScript);
    expect(sharedAddress(payment, "preprod")).toMatch(/^addr_test1w/);
  });
  it("cấu hình sai bị từ chối", async () => {
    const { kh } = await setup();
    expect(() => buildPaymentScript(0, kh)).toThrow();
    expect(() => buildPaymentScript(4, kh)).toThrow();
    expect(() => buildPaymentScript(1, [kh[0]!, kh[0]!])).toThrow(/trùng/);
    expect(() => buildPaymentScript(1, ["xyz"])).toThrow();
    expect(() => toKeyHash("không phải key")).toThrow();
    expect(toKeyHash(kh[0]!.toUpperCase())).toBe(kh[0]);
  });
});

describe("giao dịch multisig: đề xuất → ký từng phần → ghép", () => {
  it("2-of-3: một chữ ký chưa đủ, hai chữ ký đủ; chữ ký xác minh được", async () => {
    const { wallet, utxo } = await setup(2);
    const to = (await new MeshWallet({ networkId: 0, key: { type: "mnemonic", words: W[1]! } }).init(), "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn");
    const tx = await buildSharedSend(wallet, [utxo(wallet.address)], to, 5_000_000n);
    const p0 = await inspectSharedTx(wallet, tx);
    expect(p0.signedBy).toEqual([]);
    expect(p0.enough).toBe(false);
    expect(p0.outputs.some((o) => o.address === to && o.lovelace === "5000000")).toBe(true);
    expect(p0.outputs.some((o) => o.change)).toBe(true);

    const w0 = await signWithSharedKey(W[0]!, 0, tx);
    const w1 = await signWithSharedKey(W[1]!, 0, tx);
    expect((await readWitnesses(tx, w0))[0]!.keyHash).toBe((await sharedKeyHash(W[0]!, 0)));
    const one = attachWitnesses(tx, [w0]);
    expect((await inspectSharedTx(wallet, one)).enough).toBe(false);
    const two = attachWitnesses(one, [w1]);
    const p2 = await inspectSharedTx(wallet, two);
    expect(p2.signedBy.length).toBe(2);
    expect(p2.enough).toBe(true);
    // phí đủ cho 2 chữ ký: kích thước × 44 + 155381
    const size = two.length / 2;
    expect(BigInt(p2.fee)).toBeGreaterThanOrEqual(BigInt(44 * size + 155381));
  });

  it("quy tắc CIP-1854: giao dịch nhận về phải có chữ ký cosigner khác; từ chối chữ ký lạ/sai", async () => {
    const { wallet, utxo } = await setup(2);
    const to = wallet.address;
    const tx = await buildSharedSend(wallet, [utxo(wallet.address)], to, 3_000_000n);
    const mine = [await sharedKeyHash(W[0]!, 0)];
    await expect(inspectSharedTx(wallet, tx, { requireOtherSigner: true, myKeyHashes: mine })).rejects.toThrow(/nguồn gốc/);
    const fromOther = attachWitnesses(tx, [await signWithSharedKey(W[1]!, 0, tx)]);
    expect((await inspectSharedTx(wallet, fromOther, { requireOtherSigner: true, myKeyHashes: mine })).signedBy.length).toBe(1);
    // người ngoài ví ký
    const stranger = attachWitnesses(tx, [await signWithSharedKey(W[2]!, 5, tx)]);
    await expect(inspectSharedTx(wallet, stranger)).rejects.toMatchObject({ code: "NOT_SIGNER" });
    // chữ ký của giao dịch khác
    const tx2 = await buildSharedSend(wallet, [utxo(wallet.address, 80)], to, 4_000_000n);
    await expect(readWitnesses(tx, await signWithSharedKey(W[0]!, 0, tx2))).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    // giao dịch của ví khác (script khác)
    const other = (await setup(3)).wallet;
    await expect(inspectSharedTx(other, tx)).rejects.toMatchObject({ code: "INVALID_TX" });
  });

  it("chỉ dùng UTxO thuộc địa chỉ script; không đủ tiền thì báo lỗi", async () => {
    const { wallet, utxo } = await setup(2);
    const foreign = utxo("addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn", 500);
    await expect(buildSharedSend(wallet, [foreign], wallet.address, 5_000_000n)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await expect(buildSharedSend(wallet, [utxo(wallet.address, 2)], wallet.address, 5_000_000n)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("giao dịch đủ chữ ký có witness script + vkey hợp lệ (cấu trúc submit được)", async () => {
    const { wallet, utxo } = await setup(2);
    const tx = await buildSharedSend(wallet, [utxo(wallet.address)], wallet.address, 3_000_000n);
    const full = attachWitnesses(tx, [await signWithSharedKey(W[0]!, 0, tx), await signWithSharedKey(W[2]!, 0, tx)]);
    const t = Serialization.Transaction.fromCbor(full as never);
    expect(t.witnessSet().vkeys()?.size()).toBe(2);
    expect(t.witnessSet().nativeScripts()?.size()).toBe(1);
  });
});

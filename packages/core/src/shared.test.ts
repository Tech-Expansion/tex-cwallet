import { describe, it, expect } from "vitest";
import { MeshWallet, resolvePaymentKeyHash } from "@meshsdk/core";
import { Cardano, Serialization } from "@meshsdk/core-cst";
import { sharedKeyHash, signWithSharedKey, buildPaymentScript, makeSharedWallet, buildSharedSend, inspectSharedTx, attachWitnesses, readWitnesses, scriptFromCbor, scriptCborOf, scriptAddress, sharedAddress, MAX_SHARED_FEE, type NativeScriptJson, scriptHashOf, toKeyHash, SharedError } from "./shared";

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

describe("AI-45: cosigner chỉ ký giao dịch chi tiền từ đúng ví này", () => {
  const DEST = "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";
  const NIGHT = "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854";
  const coin = (address: string, hash: string, ada: number, extra: { unit: string; quantity: string }[] = []) =>
    ({ input: { txHash: hash.repeat(64).slice(0, 64), outputIndex: 0 }, output: { address, amount: [{ unit: "lovelace", quantity: String(ada * 1_000_000) }, ...extra] } });
  /** Rebuild a transaction with an edited body (and optionally other witnesses or auxiliary data). */
  const tamper = (tx: string, edit: (b: Cardano.TxBody) => Cardano.TxBody, more: { ws?: (ws: Serialization.TransactionWitnessSet) => void; aux?: Serialization.AuxiliaryData } = {}) => {
    const t = Serialization.Transaction.fromCbor(tx as never);
    const ws = t.witnessSet();
    more.ws?.(ws);
    return new Serialization.Transaction(Serialization.TransactionBody.fromCore(edit(t.body().toCore())), ws, more.aux ?? t.auxiliaryData()).toCbor();
  };
  async function proposal() {
    const { wallet } = await setup(2);
    const utxos = [coin(wallet.address, "a", 50), coin(wallet.address, "b", 30, [{ unit: NIGHT, quantity: "1000" }])];
    const tx = await buildSharedSend(wallet, utxos, DEST, 60_000_000n);
    return { wallet, utxos, tx };
  }
  const refused = (p: Promise<unknown>, why: RegExp) => expect(p).rejects.toMatchObject({ code: "INVALID_TX", message: expect.stringMatching(why) });

  it("giao dịch chi tiền bình thường: hiện số rời ví (cả phí), token theo từng output", async () => {
    const { wallet, utxos, tx } = await proposal();
    const p = await inspectSharedTx(wallet, tx, { utxos });
    expect(p.net).toEqual({ lovelace: String(60_000_000n + BigInt(p.fee)), assets: [] });
    const change = p.outputs.find((o) => o.change)!;
    expect(change.assets).toEqual([{ unit: NIGHT, quantity: "1000" }]); // the token stays in the wallet
    expect(p.outputs.find((o) => o.address === DEST)!.assets).toEqual([]);
  });

  it("ghi chú nằm trong giao dịch (CIP-20), không phải bên ngoài", async () => {
    const { wallet, utxos } = await proposal();
    const tx = await buildSharedSend(wallet, utxos, DEST, 5_000_000n, undefined, { memo: "Lương tháng 11" });
    expect((await inspectSharedTx(wallet, tx)).memo).toBe("Lương tháng 11");
  });

  it("từ chối mint, certificate, rút thưởng, collateral, reference input, governance", async () => {
    const { wallet, tx } = await proposal();
    const cred = { type: Cardano.CredentialType.KeyHash, hash: "d8db94667f661c4b7958653e048d8e114da35c75ababf82267eef4cf" as never };
    const someIn = { txId: "c".repeat(64) as never, index: 0 };
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, mint: new Map([[Cardano.AssetId(NIGHT), 1n]]) }))), /mint/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, certificates: [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: cred } as never] }))), /certificate/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, withdrawals: [{ stakeAddress: Cardano.RewardAccount.fromCredential(cred, Cardano.NetworkId.Testnet), quantity: 1n }] }))), /rút thưởng/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, collaterals: [someIn] }))), /collateral/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, referenceInputs: [someIn] }))), /reference input/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, donation: 1n }))), /governance/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, requiredExtraSignatures: [cred.hash] }))), /Plutus/);
  });

  it("từ chối script khác, metadata lạ và phí quá cao", async () => {
    const { wallet, tx } = await proposal();
    const other = (await setup(3)).wallet; // another multisig wallet with the same cosigner keys
    const extraScript = (ws: Serialization.TransactionWitnessSet) => {
      const list = [...(ws.nativeScripts()?.values() ?? []), Serialization.NativeScript.fromCbor(scriptCborOf(other.paymentScript) as never)];
      ws.setNativeScripts(Serialization.CborSet.fromCore(list.map((x) => x.toCore()), Serialization.NativeScript.fromCore) as never);
    };
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => b, { ws: extraScript })), /script khác/);
    const aux = Serialization.AuxiliaryData.fromCore({ blob: new Map([[1854n, "x"]]) });
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => b, { aux })), /metadata/);
    await refused(inspectSharedTx(wallet, tamper(tx, (b) => ({ ...b, fee: MAX_SHARED_FEE + 1n }))), /Phí quá cao/);
  });

  it("từ chối input của ví multisig khác dùng chung khóa, và input đã bị tiêu", async () => {
    const { wallet, utxos, tx } = await proposal();
    // wallet B shares a cosigner key with A; a proposal for A slips in an input that belongs to B
    const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
    const b = makeSharedWallet({ name: "B", network: "preprod", paymentScript: buildPaymentScript(1, [kh[0]!, kh[1]!]) });
    const fromB = coin(b.address, "d", 900);
    const slipped = tamper(tx, (body) => ({ ...body, inputs: [...body.inputs, { txId: fromB.input.txHash as never, index: 0 }] }));
    await refused(inspectSharedTx(wallet, slipped, { utxos: [...utxos, fromB] }), /input không thuộc ví/);
    // an input that is no longer a UTxO of the wallet (spent)
    await refused(inspectSharedTx(wallet, tx, { utxos: utxos.slice(1) }), /input không thuộc ví|đã bị tiêu/);
    // without the UTxO check (receiving a request) the structure alone still passes
    expect((await inspectSharedTx(wallet, tx)).net).toBeUndefined();
  });
});

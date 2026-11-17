import { describe, it, expect } from "vitest";
import { KoiosClient } from "./koios";
import { sharedKeyHash, buildPaymentScript, makeSharedWallet } from "./shared";
import { buildRegistrationTx } from "./registration";

const W = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
].map((m) => m.split(" "));
const MY = "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";
const utxo = { input: { txHash: "a".repeat(64), outputIndex: 0 }, output: { address: MY, amount: [{ unit: "lovelace", quantity: "50000000" }] } };

async function fixtures() {
  const kh = await Promise.all(W.map((w) => sharedKeyHash(w, 0)));
  const w1 = makeSharedWallet({ name: "Cũ", network: "preprod", paymentScript: buildPaymentScript(2, kh), signers: kh.map((k, i) => ({ keyHash: k, name: `S${i}` })) });
  const w2 = makeSharedWallet({ name: "Mới (replay)", network: "preprod", paymentScript: buildPaymentScript(1, kh) }); // cùng khóa, script khác
  return { kh, w1, w2, tx1: await buildRegistrationTx(w1, [utxo], MY), tx2: await buildRegistrationTx(w2, [utxo], MY) };
}
const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;

describe("khám phá ví multisig (CIP-0146)", () => {
  it("Koios: lấy theo nhãn 1854, đọc CBOR, giữ đăng ký cũ nhất cho mỗi khóa (chống replay)", async () => {
    const { kh, w1, tx1, tx2 } = await fixtures();
    const f = (async (url: string, init?: any) => {
      if (url.includes("/tx_by_metalabel")) return json(url.includes("offset=0") ? [{ tx_hash: "h1" }, { tx_hash: "h2" }, { tx_hash: "h0" }] : []);
      if (url.endsWith("/tx_cbor")) {
        const hs = JSON.parse(init.body)._tx_hashes as string[];
        const m: Record<string, string> = { h1: tx1, h2: tx2, h0: "84a0f5f6" };
        return json(hs.map((h) => ({ tx_hash: h, cbor: m[h] })));
      }
      return json({}, 404);
    }) as never;
    const found = await new KoiosClient("preprod", f).findRegistrations([kh[0]!]);
    expect(found.length).toBe(1); // bản sao chép (h2) của cùng khóa bị loại
    expect(found[0]!.txHash).toBe("h1");
    expect(makeSharedWallet({ name: "x", network: "preprod", paymentScript: found[0]!.payment }).address).toBe(w1.address);
    expect(await new KoiosClient("preprod", f).findRegistrations(["ff".repeat(28)])).toEqual([]);
  });

});

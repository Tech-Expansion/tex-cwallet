import { describe, it, expect } from "vitest";
import { KoiosFetcher } from "./koiosProvider";
import { defaultProviders } from "./chain";
import { KoiosClient } from "./koios";

const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) }) as Response;

describe("KoiosFetcher (thay cho KoiosProvider của Mesh bị trả 0 UTxO)", () => {
  const rows = [
    { tx_hash: "a".repeat(64), tx_index: 1, address: "addr_test1x", value: "1093391385", is_spent: false, asset_list: [{ policy_id: "fe12", asset_name: "5465", quantity: "100" }], datum_hash: null, inline_datum: null },
    { tx_hash: "b".repeat(64), tx_index: 0, address: "addr_test1x", value: "2000000", is_spent: true },
    { tx_hash: "c".repeat(64), tx_index: 2, address: "addr_test1x", value: 5000000, datum_hash: "dd".repeat(32), inline_datum: { bytes: "d8799f" } },
  ];
  it("đổi UTxO Koios sang định dạng Mesh: lovelace + token, bỏ UTxO đã tiêu, giữ datum", async () => {
    let seen: any;
    const f = (async (url: string, init: any) => { seen = { url, body: JSON.parse(init.body), method: init.method }; return json(rows); }) as never;
    const u = await new KoiosFetcher("https://k/api/v1", async () => ({}) as never, f).fetchAddressUTxOs("addr_test1x");
    expect(seen).toMatchObject({ url: "https://k/api/v1/address_utxos", method: "POST", body: { _addresses: ["addr_test1x"], _extended: true } });
    expect(u.length).toBe(2);
    expect(u[0]!.input).toEqual({ txHash: "a".repeat(64), outputIndex: 1 });
    expect(u[0]!.output.amount).toEqual([{ unit: "lovelace", quantity: "1093391385" }, { unit: "fe125465", quantity: "100" }]);
    expect(u[1]!.output).toMatchObject({ dataHash: "dd".repeat(32), plutusData: "d8799f" });
    const only = await new KoiosFetcher("https://k/api/v1", async () => ({}) as never, f).fetchAddressUTxOs("addr_test1x", "fe125465");
    expect(only.length).toBe(1);
  });

  it("gửi giao dịch: CBOR thô với content-type application/cbor, trả hash", async () => {
    let seen: any;
    const f = (async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 202, text: async () => '"' + "e".repeat(64) + '"' } as Response; }) as never;
    const h = await new KoiosFetcher("https://k/api/v1", async () => ({}) as never, f).submitTx("84a400");
    expect(h).toBe("e".repeat(64));
    expect(seen.url).toBe("https://k/api/v1/submittx");
    expect(seen.init.headers["content-type"]).toBe("application/cbor");
    expect(Buffer.from(seen.init.body).toString("hex")).toBe("84a400");
  });
  it("gửi thất bại hiện lý do; chuỗi không phải hex bị từ chối", async () => {
    const f = (async () => ({ ok: false, status: 400, text: async () => "BadInputsUTxO" }) as Response) as never;
    await expect(new KoiosFetcher("https://k", async () => ({}) as never, f).submitTx("84a400")).rejects.toThrow(/BadInputsUTxO/);
    await expect(new KoiosFetcher("https://k", async () => ({}) as never, f).submitTx("không hex")).rejects.toThrow();
  });
});

describe("chọn nguồn dữ liệu cho testnet", () => {
  it("mặc định gọi Koios trực tiếp; bản web đi qua proxy /koios/<mạng>/api/v1", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => { calls.push(url); return json([]); }) as never;
    const direct = defaultProviders("preprod", {});
    expect(direct.chain).toBeInstanceOf(KoiosClient);
    const web = defaultProviders("preprod", { proxyUrl: "https://w.example.com/proxy/", koiosViaProxy: true });
    const c = new KoiosClient("preprod", f, "https://w.example.com/proxy/koios/preprod/api/v1");
    await c.getHistory("addr_test1x");
    expect(calls[0]).toBe("https://w.example.com/proxy/koios/preprod/api/v1/address_txs");
    expect(web.chain).toBeInstanceOf(KoiosClient);
  });
});

describe("lịch sử gần đây trên dashboard (Koios)", () => {
  it("xin cả inputs trong tx_info: giao dịch gửi đi hiện số âm, không còn hiện cả tiền thối là tiền nhận", async () => {
    const ME = "addr_test1me";
    let txInfoBody: any;
    const f = (async (url: string, init: any) => {
      if (url.endsWith("/address_txs")) return json([{ tx_hash: "t1", block_time: 10 }]);
      txInfoBody = JSON.parse(init.body);
      // send 500 ADA from 8994.6 ADA: change 8494.3 back to me, fee 0.17
      return json([{ tx_hash: "t1", inputs: [{ payment_addr: { bech32: ME }, value: "8994476461" }], outputs: [{ payment_addr: { bech32: "addr_test1other" }, value: "500000000" }, { payment_addr: { bech32: ME }, value: "8494307704" }] }]);
    }) as never;
    const [t] = await new KoiosClient("preprod", f, "https://k/api/v1").getHistory(ME, 3);
    expect(txInfoBody._inputs).toBe(true);
    expect(t!.netLovelace).toBe(-500_168_757n);
  });
});

describe("thông báo lỗi gửi giao dịch dễ hiểu", async () => {
  const { explainSubmitError } = await import("./koiosProvider");
  it("lỗi 'All inputs are spent' (do giao dịch đã được gửi) được diễn giải", () => {
    const raw = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayMempoolFailure \\"All inputs are spent. Transaction has probably already been included\\""],"kind":"ShelleyTxValidationError"}}}}';
    const m = explainSubmitError(raw, 400);
    expect(m).toMatch(/^Giao dịch đã được gửi trước đó hoặc số dư/);
    expect(m).toContain("[400]");
  });
  it("các lỗi thường gặp khác", () => {
    expect(explainSubmitError("FeeTooSmallUTxO")).toMatch(/^Phí/);
    expect(explainSubmitError("MissingVKeyWitnessesUTXOW")).toMatch(/chữ ký/);
    expect(explainSubmitError("BabbageOutputTooSmallUTxO")).toMatch(/nhỏ hơn mức tối thiểu/);
    expect(explainSubmitError("lạ")).toMatch(/^Gửi giao dịch thất bại/);
  });
});

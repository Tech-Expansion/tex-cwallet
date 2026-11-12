import { describe, it, expect } from "vitest";
import { analyzeTx, historyCsv, historyPage, historyRange, readMemo, BlockfrostClient, KoiosClient, type HistorySource, type RawTx, type TxRef } from "./index";

const ME = "addr_test1qme";
const OTHER = "addr_test1qother";
const POLICY = "ab".repeat(28);
const io = (address: string, lovelace: string, assets: { unit: string; quantity: string }[] = []) => ({ address, lovelace, assets });
const H = (n: number) => n.toString(16).padStart(64, "0");

describe("AI-21: analyzeTx", () => {
  it("nhận: net dương, không trả phí, token cộng vào", () => {
    const t = analyzeTx({ hash: H(1), blockTime: 100, blockHeight: 1, fee: "170000", inputs: [io(OTHER, "10000000")], outputs: [io(ME, "3000000", [{ unit: POLICY + "01", quantity: "5" }]), io(OTHER, "6830000")] }, ME);
    expect(t).toMatchObject({ direction: "in", netLovelace: 3_000_000n, feePaid: 0n, fee: 170_000n, tokens: [{ unit: POLICY + "01", quantity: 5n }] });
  });
  it("gửi: net âm gồm phí, tự trả phí, token trừ ra", () => {
    const t = analyzeTx({
      hash: H(2), blockTime: 100, blockHeight: 1, fee: "200000",
      inputs: [io(ME, "10000000", [{ unit: POLICY + "01", quantity: "5" }])],
      outputs: [io(OTHER, "2000000", [{ unit: POLICY + "01", quantity: "2" }]), io(ME, "7800000", [{ unit: POLICY + "01", quantity: "3" }])],
    }, ME);
    expect(t).toMatchObject({ direction: "out", netLovelace: -2_200_000n, feePaid: 200_000n, tokens: [{ unit: POLICY + "01", quantity: -2n }] });
  });
  it("tự chuyển: mọi output về mình, net = -phí, token không đổi thì bỏ", () => {
    const t = analyzeTx({ hash: H(3), blockTime: 1, blockHeight: 1, fee: "180000", inputs: [io(ME, "5000000", [{ unit: "x", quantity: "1" }])], outputs: [io(ME, "4820000", [{ unit: "x", quantity: "1" }])] }, ME);
    expect(t).toMatchObject({ direction: "self", netLovelace: -180_000n, tokens: [] });
  });
  it("số rất lớn giữ chính xác (bigint)", () => {
    const big = "45000000000000000"; // 45 tỷ ADA, vượt Number.MAX_SAFE_INTEGER
    const t = analyzeTx({ hash: H(4), blockTime: 1, blockHeight: 1, fee: "0", inputs: [], outputs: [io(ME, big, [{ unit: "y", quantity: "18446744073709551615" }])] }, ME);
    expect(t.netLovelace).toBe(45_000_000_000_000_000n);
    expect(historyCsv([t])).toContain("45000000000.000000,0.000000,y:18446744073709551615");
  });
});

describe("AI-21: CIP-20 memo", () => {
  it("đọc msg dạng mảng hoặc chuỗi; bỏ qua sai định dạng", () => {
    expect(readMemo({ "674": { msg: ["xin chào", "dòng 2"] } })).toBe("xin chào\ndòng 2");
    expect(readMemo({ "674": { msg: "một dòng" } })).toBe("một dòng");
    expect(readMemo({ "674": { msg: [1, 2] } })).toBeUndefined();
    expect(readMemo({ "721": {} })).toBeUndefined();
    expect(readMemo(undefined)).toBeUndefined();
  });
});

describe("AI-21: CSV", () => {
  const t = analyzeTx({ hash: H(5), blockTime: 1_700_000_000, blockHeight: 1, fee: "170000", inputs: [io(ME, "3000000")], outputs: [io(OTHER, "1000000"), io(ME, "1830000")], metadata: { "674": { msg: ['=HYPERLINK("x"), "a"'] } } }, ME);
  const csv = historyCsv([t]);
  it("header, ngày UTC, số tiền chính xác 6 chữ số thập phân", () => {
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("date_utc,tx_hash,direction,net_ada,fee_paid_ada,token_changes,memo");
    expect(row!.startsWith(`2023-11-14T22:13:20.000Z,${H(5)},out,-1.170000,0.170000,,`)).toBe(true);
  });
  it("memo được escape và chặn công thức bảng tính", () => {
    expect(csv).toContain(`"'=HYPERLINK(""x""), ""a"""`);
  });
});

/** Fake source: 23 transactions, one per 100 seconds, newest first. */
function fakeSource(): HistorySource & { calls: string[] } {
  const all: TxRef[] = Array.from({ length: 23 }, (_, i) => ({ hash: H(100 + i), blockTime: 10_000 - i * 100, blockHeight: 500 - i }));
  const calls: string[] = [];
  return {
    calls,
    listAddressTxs: async (_a, page, count) => (calls.push(`list:${page}:${count}`), all.slice((page - 1) * count, page * count)),
    getTxs: async (hashes, meta) => (calls.push(`txs:${hashes.length}:${meta}`), hashes.map((h): RawTx => ({ hash: h, blockTime: 0, blockHeight: 0, fee: "100", inputs: [], outputs: [io(ME, "1000000")] }))),
  };
}

describe("AI-21: phân trang + khoảng thời gian", () => {
  it("trang đầy -> còn nữa; trang cuối -> hết; thời gian lấy từ danh sách khi tx thiếu", async () => {
    const s = fakeSource();
    const p1 = await historyPage(s, ME, 1, 10);
    expect(p1.items).toHaveLength(10);
    expect(p1.hasMore).toBe(true);
    expect(p1.items[0]).toMatchObject({ hash: H(100), blockTime: 10_000, blockHeight: 500 });
    const p3 = await historyPage(s, ME, 3, 10);
    expect(p3.items.map((x) => x.hash)).toEqual([H(120), H(121), H(122)]);
    expect(p3.hasMore).toBe(false);
  });
  it("giới hạn cỡ trang tối đa 50", async () => {
    const s = fakeSource();
    await historyPage(s, ME, 1, 10_000);
    expect(s.calls[0]).toBe("list:1:50");
  });
  it("lọc đúng [from, to], có metadata, dừng khi qua mốc from", async () => {
    const s = fakeSource();
    const xs = await historyRange(s, ME, 9_000, 9_500);
    expect(xs.map((x) => x.blockTime)).toEqual([9_500, 9_400, 9_300, 9_200, 9_100, 9_000]);
    expect(s.calls).toEqual(["list:1:50", "txs:6:true"]);
  });
  it("từ chối khoảng sai hoặc quá nhiều giao dịch", async () => {
    await expect(historyRange(fakeSource(), ME, 10, 5)).rejects.toThrow(/không hợp lệ/);
    await expect(historyRange(fakeSource(), ME, 0, 99_999, 5)).rejects.toThrow(/thu hẹp/);
  });
});

const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;

describe("AI-21 AC-003: Koios và Blockfrost cho cùng kết quả", () => {
  const raw = { fee: "170000", inputs: [io(ME, "5000000", [{ unit: POLICY + "01", quantity: "4" }])], outputs: [io(OTHER, "2000000", [{ unit: POLICY + "01", quantity: "1" }]), io(ME, "2830000", [{ unit: POLICY + "01", quantity: "3" }])] };
  const kio = (x: ReturnType<typeof io>) => ({ payment_addr: { bech32: x.address }, value: x.lovelace, asset_list: x.assets.map((a) => ({ policy_id: a.unit.slice(0, 56), asset_name: a.unit.slice(56), quantity: a.quantity })) });
  const bio = (x: ReturnType<typeof io>) => ({ address: x.address, amount: [{ unit: "lovelace", quantity: x.lovelace }, ...x.assets] });

  it("Koios: address_txs có phân trang, tx_info xin inputs/metadata/assets", async () => {
    const seen: { url: string; body: any }[] = [];
    const f = (async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body) });
      if (url.includes("/address_txs")) return j([{ tx_hash: H(9), block_time: 1000, block_height: 7 }]);
      return j([{ tx_hash: H(9), tx_timestamp: 1000, block_height: 7, fee: raw.fee, inputs: raw.inputs.map(kio), outputs: raw.outputs.map(kio), metadata: { "674": { msg: ["hi"] } } }]);
    }) as never;
    const p = await historyPage(new KoiosClient("preprod", f, "https://k/api/v1"), ME, 2, 5);
    expect(seen[0]!.url).toBe("https://k/api/v1/address_txs?order=block_height.desc,tx_hash.asc&limit=5&offset=5");
    expect(seen[1]!.body).toMatchObject({ _tx_hashes: [H(9)], _inputs: true, _metadata: true, _assets: true });
    expect(p.items[0]).toMatchObject({ direction: "out", netLovelace: -2_170_000n, feePaid: 170_000n, memo: "hi", tokens: [{ unit: POLICY + "01", quantity: -1n }] });
  });

  it("Blockfrost: danh sách có page, 2 request/tx, thêm metadata khi cần, bỏ collateral", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      const u = url.replace("https://p/api/v0", "");
      calls.push(u);
      if (u.startsWith(`/addresses/${ME}/transactions`)) return j([{ tx_hash: H(9), block_time: 1000, block_height: 7 }]);
      if (u === `/txs/${H(9)}`) return j({ hash: H(9), block_time: 1000, block_height: 7, fees: raw.fee });
      if (u === `/txs/${H(9)}/utxos`) return j({ inputs: [...raw.inputs.map(bio), { ...bio(io(ME, "9000000")), collateral: true }], outputs: raw.outputs.map(bio) });
      if (u === `/txs/${H(9)}/metadata`) return j([{ label: "674", json_metadata: { msg: ["hi"] } }]);
      return j({}, 500);
    }) as never;
    const c = new BlockfrostClient("https://p/api/v0", async () => ({}) as never, f);
    const p = await historyPage(c, ME, 3, 20);
    expect(calls).toEqual([`/addresses/${ME}/transactions?order=desc&count=20&page=3`, `/txs/${H(9)}`, `/txs/${H(9)}/utxos`]);
    expect(p.items[0]).toMatchObject({ direction: "out", netLovelace: -2_170_000n, memo: undefined, metadata: undefined, tokens: [{ unit: POLICY + "01", quantity: -1n }] });
    const [full] = await c.getTxs([H(9)], true);
    expect(full!.metadata).toEqual({ "674": { msg: ["hi"] } });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProxy, ttlFor } from "./proxy";

let upstreamCalls: { url: string; method: string; key?: string; body?: string }[] = [];
let status = 200;
let t = 1_000_000;
let server: Server;
let base: string;
let proxy: ReturnType<typeof createProxy>;

const fakeFetch = (async (url: string, init: any = {}) => {
  upstreamCalls.push({ url, method: init.method, key: init.headers?.project_id, body: init.body ? String(init.body) : undefined });
  return new Response(JSON.stringify({ ok: 1, url }), { status, headers: { "content-type": "application/json" } });
}) as any;

async function start(over: Partial<Parameters<typeof createProxy>[0]> = {}) {
  proxy = createProxy({ keys: { mainnet: "KEY_MAIN", preprod: "KEY_PRE" }, fetch: fakeFetch, now: () => t, adminToken: "adm", ...over });
  server = createServer((req, res) => void proxy.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  server?.close();
  upstreamCalls = [];
  status = 200;
  t = 1_000_000;
  await start();
});

const ADDR = "addr1qxyz";
const HASH = "a".repeat(64);

describe("proxy Blockfrost", () => {
  it("gắn project_id đúng theo mạng, không lộ key ra client", async () => {
    const r = await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    expect(r.status).toBe(200);
    expect(upstreamCalls[0]).toMatchObject({ key: "KEY_MAIN", url: `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${ADDR}` });
    await fetch(`${base}/preprod/api/v0/addresses/${ADDR}`);
    expect(upstreamCalls[1]!.key).toBe("KEY_PRE");
    expect(await (await fetch(`${base}/mainnet/api/v0/epochs/latest`)).text()).not.toContain("KEY_");
  });

  it("cache: lần 2 không gọi upstream, hết TTL thì gọi lại", async () => {
    await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    expect(upstreamCalls).toHaveLength(1);
    expect(proxy.stats.cacheHits.mainnet).toBe(1);
    t += 16_000;
    await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    expect(upstreamCalls).toHaveLength(2);
  });

  it("giao dịch đã xác nhận cache 1 giờ; mạng khác nhau không dùng chung cache", async () => {
    await fetch(`${base}/mainnet/api/v0/txs/${HASH}/utxos`);
    t += 3_000_000;
    await fetch(`${base}/mainnet/api/v0/txs/${HASH}/utxos`);
    expect(upstreamCalls).toHaveLength(1);
    await fetch(`${base}/preprod/api/v0/txs/${HASH}/utxos`);
    expect(upstreamCalls).toHaveLength(2);
    expect(ttlFor(`/txs/${HASH}`)).toBe(3_600_000);
    expect(ttlFor(`/addresses/${ADDR}/utxos`)).toBeLessThan(ttlFor(`/addresses/${ADDR}`) + 1);
  });

  it("gộp các request trùng đang bay thành 1 request upstream", async () => {
    await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/mainnet/api/v0/epochs/latest/parameters`)));
    expect(upstreamCalls).toHaveLength(1);
  });

  it("không cache lỗi (402/429/5xx)", async () => {
    status = 402;
    expect((await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`)).status).toBe(402);
    status = 200;
    expect((await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`)).status).toBe(200);
    expect(upstreamCalls).toHaveLength(2);
  });

  it("chỉ cho phép đúng endpoint cần dùng", async () => {
    expect((await fetch(`${base}/mainnet/api/v0/ipfs/add`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`, { method: "DELETE" })).status).toBe(403);
    expect((await fetch(`${base}/mainnet/api/v0/webhooks`)).status).toBe(403);
    expect((await fetch(`${base}/other/api/v0/addresses/x`)).status).toBe(404);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("cho phép khám phá multisig (nhãn 1854, CBOR giao dịch) nhưng chặn nhãn metadata khác", async () => {
    expect((await fetch(`${base}/mainnet/api/v0/metadata/txs/labels/1854?page=1&count=100&order=asc`)).status).toBe(200);
    expect((await fetch(`${base}/mainnet/api/v0/txs/${HASH}/cbor`)).status).toBe(200);
    expect((await fetch(`${base}/mainnet/api/v0/metadata/txs/labels/721`)).status).toBe(403);
    expect(ttlFor(`/txs/${HASH}/cbor`)).toBe(3_600_000);
    expect(ttlFor("/metadata/txs/labels/1854")).toBe(60_000);
    const n = upstreamCalls.length;
    await fetch(`${base}/mainnet/api/v0/metadata/txs/labels/1854?page=1&count=100&order=asc`);
    expect(upstreamCalls.length).toBe(n); // lần 2 lấy từ cache
  });

  it("Koios qua proxy (cho bản web): chuyển tiếp không cần khóa, chỉ endpoint cho phép, đếm riêng", async () => {
    const r = await fetch(`${base}/koios/preprod/api/v1/address_utxos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _addresses: ["a"] }) });
    expect(r.status).toBe(200);
    expect(upstreamCalls.at(-1)).toMatchObject({ url: "https://preprod.koios.rest/api/v1/address_utxos", method: "POST" });
    expect(upstreamCalls.at(-1)!.key).toBeUndefined(); // không gắn khóa Blockfrost
    expect(upstreamCalls.at(-1)!.body).toContain('"_addresses"');
    // gửi giao dịch: CBOR nhị phân
    await fetch(`${base}/koios/preview/api/v1/submittx`, { method: "POST", headers: { "content-type": "application/cbor" }, body: Buffer.from("84a400", "hex") });
    expect(upstreamCalls.at(-1)).toMatchObject({ url: "https://preview.koios.rest/api/v1/submittx", method: "POST" });
    // GET được cache; POST không
    await fetch(`${base}/koios/preprod/api/v1/epoch_params?limit=1`);
    const n = upstreamCalls.length;
    await fetch(`${base}/koios/preprod/api/v1/epoch_params?limit=1`);
    expect(upstreamCalls.length).toBe(n);
    // chặn endpoint lạ, GET submittx, mainnet không có đường Koios
    expect((await fetch(`${base}/koios/preprod/api/v1/ogmios`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${base}/koios/preprod/api/v1/submittx`)).status).toBe(403);
    expect((await fetch(`${base}/koios/mainnet/api/v1/tip`)).status).toBe(404);
    const s: any = await (await fetch(`${base}/_stats`, { headers: { authorization: "Bearer adm" } })).json();
    expect(s.upstream["koios-preprod"]).toBeGreaterThanOrEqual(2);
    expect(s.upstream["koios-preview"]).toBe(1);
  });

  it("mạng chưa cấu hình key trả 503", async () => {
    expect((await fetch(`${base}/preview/api/v0/addresses/${ADDR}`)).status).toBe(503);
  });

  it("submit giao dịch được chuyển tiếp, không cache", async () => {
    const body = Buffer.from("84a400", "hex");
    const r = await fetch(`${base}/mainnet/api/v0/tx/submit`, { method: "POST", headers: { "content-type": "application/cbor" }, body });
    expect(r.status).toBe(200);
    expect(upstreamCalls[0]).toMatchObject({ method: "POST", url: "https://cardano-mainnet.blockfrost.io/api/v0/tx/submit" });
    expect(proxy.cacheSize()).toBe(0);
  });

  it("giới hạn tốc độ theo IP và đếm số lần bị chặn", async () => {
    server.close();
    await start({ perMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/mainnet/api/v0/blocks/latest`)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(proxy.stats.rateLimited).toBe(2);
    t += 61_000;
    expect((await fetch(`${base}/mainnet/api/v0/blocks/latest`)).status).toBe(200);
  });

  it("/_stats đếm request upstream theo mạng và route, cần token", async () => {
    await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    await fetch(`${base}/mainnet/api/v0/addresses/${ADDR}`);
    await fetch(`${base}/mainnet/api/v0/txs/${HASH}`);
    expect((await fetch(`${base}/_stats`)).status).toBe(404);
    const s: any = await (await fetch(`${base}/_stats`, { headers: { authorization: "Bearer adm" } })).json();
    expect(s.clientRequests).toBe(3);
    expect(s.upstream.mainnet).toBe(2);
    expect(s.cacheHits.mainnet).toBe(1);
    expect(s.byRoute["mainnet GET /addresses/:addr"]).toBe(1);
    expect(s.byRoute["mainnet GET /txs/:hash"]).toBe(1);
  });

  it("upstream sập trả 502 và đếm lỗi", async () => {
    server.close();
    await start({ fetch: (async () => { throw new Error("down"); }) as any });
    expect((await fetch(`${base}/mainnet/api/v0/blocks/latest`)).status).toBe(502);
    expect(proxy.stats.upstreamErrors).toBe(1);
  });

  it("không tin X-Forwarded-For nếu không bật trustProxy (chống giả IP)", async () => {
    server.close();
    await start({ perMinute: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/mainnet/api/v0/blocks/latest`, { headers: { "x-forwarded-for": `1.1.1.${i}` } })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

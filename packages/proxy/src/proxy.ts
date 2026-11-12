import type { IncomingMessage, ServerResponse } from "node:http";

export type Net = "mainnet" | "preprod" | "preview";
const UPSTREAM: Record<Net, string> = {
  mainnet: "https://cardano-mainnet.blockfrost.io/api/v0",
  preprod: "https://cardano-preprod.blockfrost.io/api/v0",
  preview: "https://cardano-preview.blockfrost.io/api/v0",
};

const KOIOS: Record<"preprod" | "preview", string> = {
  preprod: "https://preprod.koios.rest/api/v1",
  preview: "https://preview.koios.rest/api/v1",
};
/** Endpoint Koios ví cần (chỉ đọc + gửi giao dịch). Koios không gửi header CORS cho phản hồi POST nên bản web phải đi qua đây. */
const KOIOS_ALLOWED = /^\/(tip|address_info|address_txs|address_utxos|tx_info|tx_cbor|tx_by_metalabel|epoch_params|submittx)(\?|$)/;

export interface ProxyOptions {
  /** Project id Blockfrost theo mạng; mạng không có key sẽ bị từ chối. */
  keys: Partial<Record<Net, string>>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Số request tối đa mỗi IP mỗi phút (mặc định 120) */
  perMinute?: number;
  /** Token xem /_stats (không đặt = tắt endpoint) */
  adminToken?: string;
  /** Origin được phép (CORS), mặc định không thêm header */
  allowOrigin?: string;
  upstream?: Partial<Record<Net, string>>;
  /** Ghi đè URL Koios (dùng khi kiểm thử) */
  koiosUpstream?: Partial<Record<"preprod" | "preview", string>>;
  /** Chỉ tin X-Forwarded-For khi chạy sau reverse proxy đáng tin (nếu không, client giả IP để né giới hạn) */
  trustProxy?: boolean;
}

/** TTL cache (ms) theo loại endpoint. Dữ liệu bất biến (tx đã xác nhận) cache lâu; số dư/UTxO cache ngắn. */
export function ttlFor(path: string): number {
  if (/^\/txs\/[0-9a-f]{64}(\/utxos|\/cbor)?$/.test(path)) return 3_600_000; // giao dịch đã vào khối không đổi
  if (path.startsWith("/metadata/txs/labels/1854") || path.startsWith("/tx_by_metalabel")) return 60_000; // danh sách đăng ký multisig (CIP-0146)
  if (path.startsWith("/epoch_params")) return 600_000;
  if (path.startsWith("/tip")) return 20_000;
  if (path.startsWith("/epochs/latest/parameters")) return 600_000;
  if (path.startsWith("/epochs/latest")) return 60_000;
  if (path.startsWith("/blocks/latest")) return 20_000;
  if (/^\/addresses\/[^/]+\/utxos/.test(path)) return 10_000;
  if (/^\/addresses\/[^/]+(\/transactions)?/.test(path)) return 15_000;
  return 15_000;
}

const group = (path: string) => path.split("?")[0]!.replace(/[0-9a-f]{64}/g, ":hash").replace(/(addr1|addr_test1)[a-z0-9]+/g, ":addr");

export interface Stats {
  upstream: Record<string, number>;
  cacheHits: Record<string, number>;
  byRoute: Record<string, number>;
  clientRequests: number;
  rateLimited: number;
  upstreamErrors: number;
}

export function createProxy(opts: ProxyOptions) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const limit = opts.perMinute ?? 120;
  const cache = new Map<string, { exp: number; status: number; body: string; type: string }>();
  const inflight = new Map<string, Promise<{ status: number; body: string; type: string }>>();
  const hits = new Map<string, number[]>();
  const stats: Stats = { upstream: {}, cacheHits: {}, byRoute: {}, clientRequests: 0, rateLimited: 0, upstreamErrors: 0 };
  const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

  const allowed = (method: string, path: string) =>
    (method === "GET" && /^\/(addresses|txs|epochs\/latest|blocks\/latest|accounts|assets|scripts)(\/|$|\?)/.test(path) || /^\/metadata\/txs\/labels\/1854(\?|$)/.test(path)) || (method === "POST" && path === "/tx/submit");

  function limited(ip: string) {
    const t = now();
    const arr = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    arr.push(t);
    hits.set(ip, arr);
    return arr.length > limit;
  }

  async function fromUpstream(net: Net, method: string, path: string, body: Buffer | undefined, contentType: string | undefined, koios?: "preprod" | "preview") {
    const base = koios ? (opts.koiosUpstream?.[koios] ?? KOIOS[koios]) : (opts.upstream?.[net] ?? UPSTREAM[net]);
    const label = koios ? `koios-${koios}` : net;
    bump(stats.upstream, label);
    bump(stats.byRoute, `${label} ${method} ${group(path)}`);
    const headers: Record<string, string> = { ...(contentType ? { "content-type": contentType } : {}), accept: "application/json" };
    if (!koios) headers.project_id = opts.keys[net]!;
    const r = await doFetch(base + path, { method, body: body as any, headers });
    return { status: r.status, body: await r.text(), type: r.headers.get("content-type") ?? "application/json" };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: string, type = "application/json") => {
      res.writeHead(status, { "content-type": type, ...(opts.allowOrigin ? { "access-control-allow-origin": opts.allowOrigin, "access-control-allow-headers": "content-type" } : {}) });
      res.end(body);
    };
    const url = new URL(req.url ?? "/", "http://x");
    const method = req.method ?? "GET";
    if (method === "OPTIONS") return send(204, "");
    if (url.pathname === "/_stats") {
      if (!opts.adminToken || req.headers.authorization !== `Bearer ${opts.adminToken}`) return send(404, '{"error":"not found"}');
      return send(200, JSON.stringify(stats, null, 2));
    }
    if (url.pathname === "/healthz") return send(200, '{"ok":true}');

    const km = url.pathname.match(/^\/koios\/(preprod|preview)\/api\/v1(\/.*)?$/);
    const m = km ? null : url.pathname.match(/^\/(mainnet|preprod|preview)\/api\/v0(\/.*)?$/);
    if (!km && !m) return send(404, '{"error":"not found"}');
    const koios = km ? (km[1] as "preprod" | "preview") : undefined;
    const net = (koios ?? m![1]) as Net;
    const path = ((km ? km[2] : m![2]) ?? "/") + url.search;
    if (koios) {
      if (!(method === "GET" || method === "POST") || !KOIOS_ALLOWED.test(path) || (path.startsWith("/submittx") && method !== "POST")) return send(403, '{"error":"endpoint not allowed"}');
    } else {
      if (!opts.keys[net]) return send(503, `{"error":"network ${net} not configured"}`);
      if (!allowed(method, path)) return send(403, '{"error":"endpoint not allowed"}');
    }

    stats.clientRequests++;
    const ip = String((opts.trustProxy && req.headers["x-forwarded-for"]) || req.socket.remoteAddress || "?").split(",")[0]!.trim();
    if (limited(ip)) {
      stats.rateLimited++;
      return send(429, '{"error":"rate limited"}');
    }

    try {
      if (method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 32_768) return send(413, '{"error":"too large"}');
          chunks.push(c as Buffer);
        }
        const r = await fromUpstream(net, method, path, Buffer.concat(chunks), req.headers["content-type"], koios);
        return send(r.status, r.body, r.type);
      }
      const key = `${koios ? "koios-" : ""}${net}:${path}`;
      const c = cache.get(key);
      if (c && c.exp > now()) {
        bump(stats.cacheHits, koios ? `koios-${koios}` : net);
        return send(c.status, c.body, c.type);
      }
      let p = inflight.get(key);
      if (p) bump(stats.cacheHits, koios ? `koios-${koios}` : net); // gộp request trùng đang bay
      else {
        p = fromUpstream(net, method, path, undefined, undefined, koios).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const r = await p;
      // Chỉ cache kết quả thành công (và 404 địa chỉ mới, ngắn hạn). Lỗi 402/429/5xx không được cache.
      if (r.status === 200 || r.status === 404) cache.set(key, { ...r, exp: now() + (r.status === 404 ? 5_000 : ttlFor(path.split("?")[0]!)) });
      return send(r.status, r.body, r.type);
    } catch {
      stats.upstreamErrors++;
      return send(502, '{"error":"upstream unavailable"}');
    }
  }

  return { handle, stats, cacheSize: () => cache.size };
}

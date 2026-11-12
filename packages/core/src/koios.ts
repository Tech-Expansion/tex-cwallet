import { castProtocol } from "@meshsdk/common";
import type { Protocol } from "@meshsdk/core";
import { NETWORKS, type NetworkName } from "./networks";
import { parseRegistration, registrationHasKey, REGISTRATION_LABEL, type Registration } from "./registration";

export interface TxSummary {
  hash: string;
  blockTime: number;
  /** Thay đổi ròng (lovelace) của địa chỉ trong giao dịch; âm = chi ra */
  netLovelace: bigint;
}

export interface AssetBalance {
  unit: string; // "lovelace" hoặc policyId+assetNameHex
  quantity: string;
}

type Fetch = typeof fetch;

/** Client Koios tối giản (không API key). Dùng cho số dư, lịch sử, tip. */
export class KoiosClient {
  constructor(
    readonly network: NetworkName,
    private readonly f: Fetch = (...a) => fetch(...a),
    /** URL gốc tuỳ chọn (ví dụ qua proxy cho bản web, vì Koios không gửi header CORS trong phản hồi POST) */
    private readonly baseUrl?: string,
  ) {}

  private get url() {
    if (this.baseUrl) return this.baseUrl;
    const d = NETWORKS[this.network].defaultProvider;
    if (d.kind !== "koios") throw new Error(`${this.network} không dùng Koios`);
    return d.url;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await this.f(`${this.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Koios ${path} lỗi ${r.status}`);
    return (await r.json()) as T;
  }

  async txExists(txHash: string): Promise<boolean> {
    const rows = await this.post<unknown[]>("/tx_info", { _tx_hashes: [txHash] });
    return rows.length > 0;
  }

  /** Tham số giao thức mới nhất (cần để tính phí đúng). */
  async getProtocolParams(): Promise<Protocol> {
    const r = await this.f(`${this.url}/epoch_params?limit=1&order=epoch_no.desc`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Koios epoch_params lỗi ${r.status}`);
    const p = (await r.json())[0];
    if (!p) throw new Error("Koios không trả tham số giao thức");
    const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const mapped: Record<string, unknown> = { epoch: p.epoch_no, maxBlockHeaderSize: p.max_bh_size };
    for (const [k, v] of Object.entries(p)) mapped[camel(k)] ??= v;
    return castProtocol(mapped as any);
  }

  /**
   * Khám phá ví multisig (CIP-0146): quét giao dịch nhãn 1854 theo thứ tự cũ → mới, lấy CBOR, đọc script,
   * giữ những đăng ký có chứa key credential của mình. Trả về bản cũ nhất cho mỗi credential (chống replay).
   */
  async findRegistrations(credentials: string[], maxTxs = 2000): Promise<Registration[]> {
    const want = new Set(credentials);
    const found: Registration[] = [];
    const seenCred = new Set<string>();
    for (let offset = 0; offset < maxTxs; offset += 200) {
      const r = await this.f(`${this.url}/tx_by_metalabel?_label=${REGISTRATION_LABEL}&order=block_height.asc&limit=200&offset=${offset}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`Koios tx_by_metalabel lỗi ${r.status}`);
      const page = (await r.json()) as { tx_hash: string }[];
      for (let i = 0; i < page.length; i += 50) {
        const hashes = page.slice(i, i + 50).map((t) => t.tx_hash);
        const cbors = await this.post<{ tx_hash: string; cbor: string }[]>("/tx_cbor", { _tx_hashes: hashes });
        for (const c of cbors.sort((a, b) => hashes.indexOf(a.tx_hash) - hashes.indexOf(b.tx_hash))) {
          const reg = parseRegistration(c.cbor);
          if (!reg) continue;
          const mine = [...want].filter((k) => registrationHasKey(reg, k));
          if (!mine.some((k) => !seenCred.has(k))) continue; // đăng ký sau của cùng khóa bị bỏ qua
          mine.forEach((k) => seenCred.add(k));
          found.push({ ...reg, txHash: c.tx_hash });
        }
      }
      if (page.length < 200) break;
    }
    return found;
  }

  async getBalance(addresses: string[]): Promise<AssetBalance[]> {
    const rows = await this.post<any[]>("/address_info", { _addresses: addresses });
    const totals = new Map<string, bigint>();
    const add = (u: string, q: string | bigint) => totals.set(u, (totals.get(u) ?? 0n) + BigInt(q));
    for (const row of rows) {
      add("lovelace", row.balance ?? 0);
      for (const utxo of row.utxo_set ?? [])
        for (const a of utxo.asset_list ?? []) add(a.policy_id + a.asset_name, a.quantity);
    }
    return [...totals].map(([unit, q]) => ({ unit, quantity: q.toString() }));
  }

  async getHistory(address: string, limit = 20): Promise<TxSummary[]> {
    const list = await this.post<{ tx_hash: string; block_time: number }[]>("/address_txs", { _addresses: [address] });
    const recent = list.sort((a, b) => b.block_time - a.block_time).slice(0, limit);
    if (!recent.length) return [];
    const infos = await this.post<any[]>("/tx_info", { _tx_hashes: recent.map((t) => t.tx_hash) });
    const byHash = new Map(infos.map((i) => [i.tx_hash, i]));
    return recent.map((t) => {
      const info = byHash.get(t.tx_hash);
      let net = 0n;
      for (const o of info?.outputs ?? []) if (o.payment_addr?.bech32 === address) net += BigInt(o.value);
      for (const i of info?.inputs ?? []) if (i.payment_addr?.bech32 === address) net -= BigInt(i.value);
      return { hash: t.tx_hash, blockTime: t.block_time, netLovelace: net };
    });
  }
}

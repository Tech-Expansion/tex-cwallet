import type { Protocol } from "@meshsdk/core";
import type { AssetBalance, TxSummary } from "./koios";
import { parseRegistration, registrationHasKey, REGISTRATION_LABEL, type Registration } from "./registration";

type Fetch = typeof fetch;

/**
 * Client Blockfrost tối giản (hoặc proxy tương thích). Chỉ gọi những endpoint cần thiết để tiết kiệm request:
 * số dư = 1 request, lịch sử = 1 + N request (Blockfrost không có lệnh lấy hàng loạt).
 */
export class BlockfrostClient {
  constructor(
    private readonly base: string,
    private readonly params: () => Promise<Protocol>,
    private readonly f: Fetch = (...a) => fetch(...a),
  ) {}

  private async get<T>(path: string): Promise<T | null> {
    const r = await this.f(this.base + path, { headers: { accept: "application/json" } });
    if (r.status === 404) return null; // địa chỉ chưa từng xuất hiện trên chuỗi
    if (r.status === 402) throw new Error("Nguồn dữ liệu đã hết hạn mức (402)");
    if (r.status === 429) throw new Error("Quá nhiều yêu cầu, thử lại sau (429)");
    if (!r.ok) throw new Error(`Blockfrost ${path} lỗi ${r.status}`);
    return (await r.json()) as T;
  }

  async getBalance(addresses: string[]): Promise<AssetBalance[]> {
    const totals = new Map<string, bigint>();
    for (const a of addresses) {
      const info = await this.get<{ amount: { unit: string; quantity: string }[] }>(`/addresses/${a}`);
      for (const x of info?.amount ?? []) totals.set(x.unit, (totals.get(x.unit) ?? 0n) + BigInt(x.quantity));
    }
    return [...totals].map(([unit, q]) => ({ unit, quantity: q.toString() }));
  }

  async getHistory(address: string, limit = 20): Promise<TxSummary[]> {
    const list = (await this.get<{ tx_hash: string; block_time: number }[]>(`/addresses/${address}/transactions?order=desc&count=${limit}`)) ?? [];
    const lovelace = (xs: { unit: string; quantity: string }[]) => BigInt(xs.find((x) => x.unit === "lovelace")?.quantity ?? 0);
    return Promise.all(
      list.map(async (t) => {
        const u = await this.get<{ inputs: { address: string; amount: any[] }[]; outputs: { address: string; amount: any[] }[] }>(`/txs/${t.tx_hash}/utxos`);
        let net = 0n;
        for (const o of u?.outputs ?? []) if (o.address === address) net += lovelace(o.amount);
        for (const i of u?.inputs ?? []) if (i.address === address) net -= lovelace(i.amount);
        return { hash: t.tx_hash, blockTime: t.block_time, netLovelace: net };
      }),
    );
  }

  /**
   * Khám phá ví multisig (CIP-0146). Blockfrost lọc theo nhãn 1854 cho metadata (participants);
   * chỉ những giao dịch khớp mới tải CBOR để lấy native script, rồi xác minh khóa của mình nằm trong script thật.
   */
  async findRegistrations(credentials: string[], maxPages = 10): Promise<Registration[]> {
    const want = new Set(credentials.map((c) => c.toLowerCase()));
    const found: Registration[] = [];
    const seenCred = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const batch = (await this.get<{ tx_hash: string; json_metadata?: { participants?: Record<string, unknown> } | null }[]>(`/metadata/txs/labels/${REGISTRATION_LABEL}?page=${page}&count=100&order=asc`)) ?? [];
      for (const item of batch) {
        const claimed = Object.keys(item.json_metadata?.participants ?? {}).map((k) => k.toLowerCase());
        if (!claimed.some((k) => want.has(k))) continue;
        const cbor = await this.get<{ cbor: string }>(`/txs/${item.tx_hash}/cbor`);
        const reg = cbor ? parseRegistration(cbor.cbor) : null;
        if (!reg) continue;
        const mine = [...want].filter((k) => registrationHasKey(reg, k)); // tin script thật, không tin participants
        if (!mine.some((k) => !seenCred.has(k))) continue;
        mine.forEach((k) => seenCred.add(k));
        found.push({ ...reg, txHash: item.tx_hash });
      }
      if (batch.length < 100) break;
    }
    return found;
  }

  async txExists(txHash: string): Promise<boolean> {
    return (await this.get(`/txs/${txHash}`)) !== null;
  }

  getProtocolParams() {
    return this.params();
  }
}

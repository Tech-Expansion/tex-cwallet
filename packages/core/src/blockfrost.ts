import type { Protocol } from "@meshsdk/core";
import type { AssetBalance, ChainTip, TxSummary } from "./koios";
import type { RawIO, RawTx, TxRef } from "./history";
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

  /** Newest first. */
  async listAddressTxs(address: string, page: number, count: number): Promise<TxRef[]> {
    const rows = (await this.get<{ tx_hash: string; block_time: number; block_height: number }[]>(`/addresses/${address}/transactions?order=desc&count=${count}&page=${page}`)) ?? [];
    return rows.map((r) => ({ hash: r.tx_hash, blockTime: r.block_time, blockHeight: r.block_height }));
  }

  /** 2 requests per transaction (/txs/{h}, /utxos), 3 with metadata. Blockfrost has no batch endpoint. */
  async getTxs(hashes: string[], withMetadata: boolean): Promise<RawTx[]> {
    const io = (x: { address: string; amount: { unit: string; quantity: string }[] }): RawIO => ({
      address: x.address,
      lovelace: x.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0",
      assets: x.amount.filter((a) => a.unit !== "lovelace").map((a) => ({ unit: a.unit, quantity: a.quantity })),
    });
    const one = async (h: string): Promise<RawTx | null> => {
      const [tx, u, meta] = await Promise.all([
        this.get<{ hash: string; block_time: number; block_height: number; fees: string }>(`/txs/${h}`),
        this.get<{ inputs: any[]; outputs: any[] }>(`/txs/${h}/utxos`),
        withMetadata ? this.get<{ label: string; json_metadata: unknown }[]>(`/txs/${h}/metadata`) : Promise.resolve(undefined),
      ]);
      if (!tx || !u) return null;
      return {
        hash: h,
        blockTime: tx.block_time,
        blockHeight: tx.block_height,
        fee: String(tx.fees),
        inputs: (u.inputs ?? []).filter((i: any) => !i.collateral && !i.reference).map(io),
        outputs: (u.outputs ?? []).filter((o: any) => !o.collateral).map(io),
        metadata: meta === undefined ? undefined : Object.fromEntries((meta ?? []).map((m) => [m.label, m.json_metadata])),
      };
    };
    const out: RawTx[] = [];
    for (let i = 0; i < hashes.length; i += 10) out.push(...(await Promise.all(hashes.slice(i, i + 10).map(one))).filter((x): x is RawTx => !!x));
    return out;
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

  async getTip(): Promise<ChainTip> {
    const b = await this.get<{ hash: string; epoch: number; slot: number; height: number; time: number }>("/blocks/latest");
    if (!b) throw new Error("Blockfrost không trả tip");
    return { hash: b.hash, epoch: b.epoch, slot: b.slot, blockHeight: b.height, blockTime: b.time };
  }

  async txExists(txHash: string): Promise<boolean> {
    return (await this.get(`/txs/${txHash}`)) !== null;
  }

  getProtocolParams() {
    return this.params();
  }
}

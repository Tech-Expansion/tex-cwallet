import { castProtocol } from "@meshsdk/common";
import type { Protocol } from "@meshsdk/core";
import { NETWORKS, type NetworkName } from "./networks";
import type { RawIO, RawTx, TxRef } from "./history";
import { isPoolId, type PoolInfo, type StakeAccount } from "./staking";
import { cip25Entry, cip68FromDatum, splitUnit, CIP68_NFT_LABEL, CIP68_REF_LABEL, type RawNftMetadata } from "./nft";
import { parseRegistration, registrationHasKey, REGISTRATION_LABEL, type Registration } from "./registration";

export interface TxSummary {
  hash: string;
  blockTime: number;
  /** Thay đổi ròng (lovelace) của địa chỉ trong giao dịch; âm = chi ra */
  netLovelace: bigint;
}

/** Current chain tip. */
export interface ChainTip {
  hash: string;
  epoch: number;
  slot: number;
  blockHeight: number;
  blockTime: number;
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

  async getTip(): Promise<ChainTip> {
    const r = await this.f(`${this.url}/tip`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Koios tip lỗi ${r.status}`);
    const t = ((await r.json()) as any[])[0];
    if (!t) throw new Error("Koios không trả tip");
    return { hash: t.hash, epoch: Number(t.epoch_no), slot: Number(t.abs_slot), blockHeight: Number(t.block_no), blockTime: Number(t.block_time) };
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

  /**
   * asset_info in batches of 50. CIP-25 comes from the latest mint's label 721; for a CIP-68 user token the
   * (100) reference token is asked for too and its datum gives the metadata.
   */
  async getNftMetadata(units: string[]): Promise<Record<string, RawNftMetadata>> {
    const refOf = (u: string) => { const s = splitUnit(u); return s.label === CIP68_NFT_LABEL ? s.policyId + CIP68_REF_LABEL + s.nameHex : undefined; };
    const ask = [...new Set(units.flatMap((u) => [u, refOf(u)].filter((x): x is string => !!x)))];
    const info = new Map<string, any>();
    for (let i = 0; i < ask.length; i += 50) {
      const rows = await this.post<any[]>("/asset_info", { _asset_list: ask.slice(i, i + 50).map((u) => [u.slice(0, 56), u.slice(56)]) });
      for (const r of rows) info.set(r.policy_id + r.asset_name, r);
    }
    const datumOf = (c: any) => (c && typeof c === "object" ? (c["100"] ?? c) : undefined);
    const out: Record<string, RawNftMetadata> = {};
    for (const u of units) {
      const r = info.get(u);
      const ref = refOf(u);
      const cip68 = ref ? cip68FromDatum(datumOf(info.get(ref)?.cip68_metadata) ?? datumOf(r?.cip68_metadata)) : undefined;
      const { policyId, nameHex } = splitUnit(u);
      const cip25 = !ref ? cip25Entry(r?.minting_tx_metadata?.["721"], policyId, nameHex) : undefined;
      if (cip68 || cip25) out[u] = { ...(cip68 ? { cip68 } : {}), ...(cip25 ? { cip25 } : {}) };
    }
    return out;
  }

  async getStakeAccount(stakeAddress: string): Promise<StakeAccount> {
    const [a] = await this.post<{ status?: string; delegated_pool?: string | null; rewards_available?: string }[]>("/account_info", { _stake_addresses: [stakeAddress] });
    return { registered: a?.status === "registered", poolId: a?.delegated_pool ?? undefined, rewards: BigInt(a?.rewards_available ?? 0) };
  }

  async searchPools(query: string): Promise<PoolInfo[]> {
    const q = query.trim();
    let ids: string[];
    if (isPoolId(q)) ids = [q];
    else {
      if (!/^[A-Za-z0-9]{1,10}$/.test(q)) return [];
      const r = await this.f(`${this.url}/pool_list?ticker=ilike.*${q}*&pool_status=eq.registered&limit=20`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`Koios pool_list lỗi ${r.status}`);
      ids = ((await r.json()) as { pool_id_bech32: string }[]).map((x) => x.pool_id_bech32);
    }
    if (!ids.length) return [];
    const rows = await this.post<any[]>("/pool_info", { _pool_bech32_ids: ids });
    return rows.map((p) => ({
      poolId: p.pool_id_bech32,
      ticker: p.meta_json?.ticker ?? undefined,
      name: p.meta_json?.name ?? undefined,
      margin: Number(p.margin ?? 0),
      fixedCost: BigInt(p.fixed_cost ?? 0),
      pledge: BigInt(p.pledge ?? 0),
      liveStake: BigInt(p.live_stake ?? 0),
      saturation: p.live_saturation == null ? undefined : Number(p.live_saturation),
      retiring: p.pool_status !== undefined && p.pool_status !== "registered",
    }));
  }

  async accountAddresses(stakeAddress: string): Promise<string[]> {
    const rows = await this.post<{ addresses?: string[] }[]>("/account_addresses", { _stake_addresses: [stakeAddress], _empty: true });
    return rows.flatMap((r) => r.addresses ?? []);
  }

  async assetAddresses(unit: string): Promise<string[]> {
    const q = `_asset_policy=${unit.slice(0, 56)}&_asset_name=${unit.slice(56)}`;
    const r = await this.f(`${this.url}/asset_addresses?${q}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Koios asset_addresses lỗi ${r.status}`);
    const rows = (await r.json()) as { payment_address: string; quantity: string }[];
    return rows.filter((x) => BigInt(x.quantity) > 0n).map((x) => x.payment_address);
  }

  /** Newest first. Koios accepts PostgREST paging/order on POST endpoints. */
  async listAddressTxs(address: string | string[], page: number, count: number): Promise<TxRef[]> {
    const q = `order=block_height.desc,tx_hash.asc&limit=${count}&offset=${(page - 1) * count}`;
    const rows = await this.post<{ tx_hash: string; block_time: number; block_height: number }[]>(`/address_txs?${q}`, { _addresses: Array.isArray(address) ? address : [address] });
    return rows.map((r) => ({ hash: r.tx_hash, blockTime: Number(r.block_time), blockHeight: Number(r.block_height) }));
  }

  /** tx_info in batches of 50; metadata comes in the same response, so it is always included. */
  async getTxs(hashes: string[], _withMetadata = true): Promise<RawTx[]> {
    const io = (x: any): RawIO => ({
      address: x.payment_addr?.bech32 ?? "",
      lovelace: String(x.value ?? 0),
      assets: (x.asset_list ?? []).map((a: any) => ({ unit: a.policy_id + a.asset_name, quantity: String(a.quantity) })),
    });
    const out: RawTx[] = [];
    for (let i = 0; i < hashes.length; i += 50) {
      const rows = await this.post<any[]>("/tx_info", { _tx_hashes: hashes.slice(i, i + 50), _inputs: true, _metadata: true, _assets: true });
      for (const t of rows)
        out.push({
          hash: t.tx_hash,
          blockTime: Number(t.tx_timestamp ?? t.block_time ?? 0),
          blockHeight: Number(t.block_height ?? 0),
          fee: String(t.fee ?? 0),
          inputs: (t.inputs ?? []).map(io),
          outputs: (t.outputs ?? []).map(io),
          metadata: t.metadata && typeof t.metadata === "object" ? t.metadata : {},
        });
    }
    return out;
  }

  async getHistory(address: string, limit = 20): Promise<TxSummary[]> {
    const list = await this.post<{ tx_hash: string; block_time: number }[]>("/address_txs", { _addresses: [address] });
    const recent = list.sort((a, b) => b.block_time - a.block_time).slice(0, limit);
    if (!recent.length) return [];
    // _inputs: Koios leaves inputs out of tx_info by default; without them every transaction looked incoming.
    const infos = await this.post<any[]>("/tx_info", { _tx_hashes: recent.map((t) => t.tx_hash), _inputs: true });
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

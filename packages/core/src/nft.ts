/**
 * NFT gallery (AI-24): read CIP-25 and CIP-68 metadata, resolve images safely, cache locally.
 * Display and transfer only; no prices, no marketplace.
 */
import { decodeAssetName } from "./balance";
import type { KeyValueStore } from "./storage";

/** CIP-67 labels */
export const CIP68_REF_LABEL = "000643b0"; // (100) reference NFT holding the metadata datum
export const CIP68_NFT_LABEL = "000de140"; // (222) user NFT

/**
 * IPFS gateways the user can choose from. The extension CSP (img-src) allows exactly these hosts plus
 * Arweave; any other image host is blocked, so the list and the CSP must change together.
 */
export const IPFS_GATEWAYS = ["https://ipfs.io", "https://dweb.link", "https://gateway.pinata.cloud", "https://nftstorage.link"] as const;
export type IpfsGateway = (typeof IPFS_GATEWAYS)[number];
export const DEFAULT_IPFS_GATEWAY: IpfsGateway = "https://ipfs.io";
export const ARWEAVE_GATEWAY = "https://arweave.net";
/** Hosts allowed in img-src (keep in sync with the extension manifest and web.html) */
export const IMAGE_HOSTS = [...IPFS_GATEWAYS, ARWEAVE_GATEWAY];

export const isIpfsGateway = (g: unknown): g is IpfsGateway => typeof g === "string" && (IPFS_GATEWAYS as readonly string[]).includes(g);

/** What a data source returns for one asset. */
export interface RawNftMetadata {
  /** CIP-25: the asset's entry under label 721 of its latest mint (policy/name level already selected) */
  cip25?: Record<string, unknown>;
  /** CIP-68: the metadata map of the (100) reference datum, already decoded to JSON values */
  cip68?: Record<string, unknown>;
}

export interface NftMetadataSource {
  /** Metadata per unit; missing units have none */
  getNftMetadata(units: string[]): Promise<Record<string, RawNftMetadata>>;
}

export interface NftFile { name?: string; mediaType?: string; src: string }

export interface Nft {
  unit: string;
  policyId: string;
  /** Asset name without the CIP-67 label, readable when possible */
  assetName: string;
  standard: "cip25" | "cip68" | "none";
  name: string;
  /** Raw image reference from the metadata (ipfs://, ar://, https://, data:) */
  image?: string;
  mediaType?: string;
  description?: string;
  files: NftFile[];
  /** Other metadata fields, as text */
  attributes: { key: string; value: string }[];
}

const RESERVED = new Set(["name", "image", "mediaType", "description", "files"]);

/** CIP-25 lets long strings be split into arrays of ≤64-byte chunks. */
const joinText = (v: unknown): string | undefined => (typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join("") : undefined);

const asText = (v: unknown): string => {
  const t = joinText(v);
  if (t !== undefined) return t;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};

/** Split a unit into policy, CIP-67 label (when present) and the bare name. */
export function splitUnit(unit: string): { policyId: string; label?: string; nameHex: string } {
  const policyId = unit.slice(0, 56);
  const rest = unit.slice(56);
  for (const label of [CIP68_NFT_LABEL, CIP68_REF_LABEL, "0014df10", "001bc280"]) if (rest.startsWith(label)) return { policyId, label, nameHex: rest.slice(8) };
  return { policyId, nameHex: rest };
}

/** Normalize CIP-25 / CIP-68 metadata into one shape. CIP-68 wins when both exist. */
export function parseNft(unit: string, raw: RawNftMetadata | undefined): Nft {
  const { policyId, nameHex } = splitUnit(unit);
  const assetName = decodeAssetName(nameHex) ?? nameHex;
  const meta = raw?.cip68 ?? raw?.cip25;
  const standard = raw?.cip68 ? "cip68" : raw?.cip25 ? "cip25" : "none";
  const files: NftFile[] = [];
  for (const f of Array.isArray(meta?.files) ? (meta!.files as Record<string, unknown>[]) : []) {
    const src = joinText(f?.src);
    if (src) files.push({ src, name: joinText(f.name), mediaType: joinText(f.mediaType) });
  }
  const attributes = Object.entries(meta ?? {})
    .filter(([k]) => !RESERVED.has(k))
    .map(([key, v]) => ({ key, value: asText(v).slice(0, 500) }));
  return {
    unit,
    policyId,
    assetName,
    standard,
    name: (joinText(meta?.name) ?? assetName).slice(0, 120),
    image: joinText(meta?.image),
    mediaType: joinText(meta?.mediaType),
    description: joinText(meta?.description)?.slice(0, 2000),
    files,
    attributes,
  };
}

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})(\/[^\s?#]*)?$/;
const SAFE_DATA = /^data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml)(;[a-z0-9=._-]+)*(;base64)?,/i;

/**
 * Turn an image reference into a URL an <img> may load, or undefined when it is not allowed.
 * Only the chosen IPFS gateway, Arweave and image data URIs pass; images are only ever shown with
 * <img> (SVG in <img> cannot run scripts) and HTML from metadata is never rendered.
 */
export function resolveImage(src: string | undefined, gateway: string = DEFAULT_IPFS_GATEWAY): string | undefined {
  const s = (src ?? "").trim();
  if (!s) return undefined;
  const gw = isIpfsGateway(gateway) ? gateway : DEFAULT_IPFS_GATEWAY;
  if (SAFE_DATA.test(s)) return s;
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(s)?.[1] ?? (CID.test(s) ? s : undefined);
  if (ipfs) return CID.test(ipfs) ? `${gw}/ipfs/${ipfs}` : undefined;
  const ar = /^ar:\/\/([A-Za-z0-9_-]{43})$/.exec(s)?.[1];
  if (ar) return `${ARWEAVE_GATEWAY}/${ar}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return undefined;
    if (u.pathname.startsWith("/ipfs/") && CID.test(u.pathname.slice(6))) return `${gw}${u.pathname}`; // any gateway -> ours
    return IMAGE_HOSTS.includes(u.origin) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Plutus data in Koios/cardano-cli "detailed schema" JSON -> plain JSON (bytes as UTF-8 text when readable). */
export function datumToJson(d: unknown): unknown {
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (typeof o.bytes === "string") return decodeAssetName(o.bytes) ?? o.bytes;
    if (o.int !== undefined) return String(o.int);
    if (Array.isArray(o.list)) return o.list.map(datumToJson);
    if (Array.isArray(o.map)) {
      const out: Record<string, unknown> = {};
      for (const e of o.map as { k: unknown; v: unknown }[]) out[String(datumToJson(e.k))] = datumToJson(e.v);
      return out;
    }
    if (Array.isArray(o.fields)) return o.fields.map(datumToJson);
  }
  return d;
}

/** CIP-68 reference datum: Constr 0 [metadata map, version, extra]. Returns the metadata map. */
export function cip68FromDatum(datum: unknown): Record<string, unknown> | undefined {
  const fields = (datum as { fields?: unknown[] } | undefined)?.fields;
  const m = fields?.[0] ? datumToJson(fields[0]) : undefined;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : undefined;
}

/** CIP-25 label 721 JSON -> the entry for one asset (v1: hex-decoded name key; v2: hex key). */
export function cip25Entry(label721: unknown, policyId: string, nameHex: string): Record<string, unknown> | undefined {
  const byPolicy = (label721 as Record<string, unknown> | undefined)?.[policyId] as Record<string, unknown> | undefined;
  if (!byPolicy || typeof byPolicy !== "object") return undefined;
  const e = byPolicy[decodeAssetName(nameHex) ?? ""] ?? byPolicy[nameHex];
  return e && typeof e === "object" ? (e as Record<string, unknown>) : undefined;
}

// ---------- local cache (AC-001) ----------

const CACHE_KEY = "nft-cache-v1";
export const NFT_CACHE_TTL_MS = 7 * 24 * 3600_000;
export const NFT_CACHE_MAX = 1000;
/** Large on-chain images are not cached (fetched again when needed) */
const CACHE_MAX_IMAGE_CHARS = 64_000;

type CacheEntry = { at: number; nft: Nft };

/** Metadata cache in local storage. Holds only public on-chain data. */
export class NftCache {
  private mem?: Record<string, CacheEntry>;
  constructor(private readonly store: KeyValueStore, private readonly now: () => number = Date.now) {}

  private async all() {
    return (this.mem ??= (await this.store.get<Record<string, CacheEntry>>(CACHE_KEY)) ?? {});
  }

  async get(units: string[]): Promise<Map<string, Nft>> {
    const all = await this.all();
    const out = new Map<string, Nft>();
    for (const u of units) {
      const e = all[u];
      if (e && this.now() - e.at < NFT_CACHE_TTL_MS) out.set(u, e.nft);
    }
    return out;
  }

  async put(nfts: Nft[]) {
    const all = await this.all();
    for (const n of nfts) if ((n.image?.length ?? 0) <= CACHE_MAX_IMAGE_CHARS) all[n.unit] = { at: this.now(), nft: n };
    const keys = Object.keys(all);
    if (keys.length > NFT_CACHE_MAX) for (const k of keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - NFT_CACHE_MAX)) delete all[k];
    await this.store.set(CACHE_KEY, all);
  }

  async clear() {
    this.mem = {};
    await this.store.remove(CACHE_KEY);
  }
}

/** Units in a balance that look like NFTs: quantity 1, or a CIP-68 (222) user token. */
export function nftUnits(assets: { unit: string; quantity: bigint | string }[]): string[] {
  return assets.filter((a) => a.unit !== "lovelace" && (BigInt(a.quantity) === 1n || splitUnit(a.unit).label === CIP68_NFT_LABEL)).map((a) => a.unit);
}

/** Load NFTs for these units: cache first, then the data source for the rest. */
export async function loadNfts(src: NftMetadataSource, cache: NftCache, units: string[], refresh = false): Promise<Nft[]> {
  const cached = refresh ? new Map<string, Nft>() : await cache.get(units);
  const missing = units.filter((u) => !cached.has(u));
  if (missing.length) {
    const raw = await src.getNftMetadata(missing);
    const fresh = missing.map((u) => parseNft(u, raw[u]));
    await cache.put(fresh);
    for (const n of fresh) cached.set(n.unit, n);
  }
  return units.map((u) => cached.get(u)!).filter(Boolean);
}

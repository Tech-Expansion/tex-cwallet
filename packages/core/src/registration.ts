// CIP-0146: đăng ký ví multisig on-chain (metadata nhãn 1854 + native_scripts trong auxiliary data) và đọc lại.
import { MeshTxBuilder } from "@meshsdk/core";
import type { UTxO, Protocol } from "@meshsdk/core";
import { Serialization, computeAuxiliaryDataHash } from "@meshsdk/core-cst";
import { scriptCborOf, scriptFromCbor, keysOf, SharedError, type NativeScriptJson, type SharedWallet } from "./shared";
import { NETWORKS } from "./networks";

export const REGISTRATION_LABEL = 1854;
export const METADATA_STRING_MAX_BYTES = 64;

export interface Label1854Metadata {
  types: number[]; // 0 = thanh toán, 2 = stake (khớp với mảng native_script)
  name?: string;
  description?: string;
  participants?: Record<string, { name: string }>;
}

/** Chuỗi metadata Cardano tối đa 64 byte: cắt theo ký tự để không vỡ UTF-8. */
export function truncateMetadataString(s: string, max = METADATA_STRING_MAX_BYTES): string {
  const enc = new TextEncoder();
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

export function registrationMetadata(w: SharedWallet): Label1854Metadata {
  const m: Label1854Metadata = { types: w.stakeScript ? [0, 2] : [0] };
  if (w.name) m.name = truncateMetadataString(w.name);
  m.participants = Object.fromEntries(w.signers.map((s) => [s.keyHash, { name: truncateMetadataString(s.name) }]));
  return m;
}

const VKEY = 101;

/**
 * Giao dịch đăng ký (chưa ký): trả phí từ ví thường của người đăng ký, ghi metadata 1854 và đính native_scripts
 * vào auxiliary data. CIP-0146 yêu cầu khóa dùng để đăng ký chưa từng xuất hiện on-chain.
 */
export async function buildRegistrationTx(w: SharedWallet, utxos: UTxO[], changeAddress: string, params?: Partial<Protocol>): Promise<string> {
  const scripts = [scriptCborOf(w.paymentScript, NETWORKS[w.network].networkId), ...(w.stakeScript ? [scriptCborOf(w.stakeScript, NETWORKS[w.network].networkId)] : [])];
  const extra = scripts.reduce((n, s) => n + s.length / 2 + 6, 0);
  const a = BigInt(params?.minFeeA ?? 44), b = BigInt(params?.minFeeB ?? 155381);
  const base = await new MeshTxBuilder({ params }).metadataValue(REGISTRATION_LABEL, registrationMetadata(w) as never).changeAddress(changeAddress).selectUtxosFrom(utxos).complete();
  const fee = a * (BigInt(base.length / 2) + BigInt(extra) + BigInt(VKEY + 16)) + b + 2_000n;
  const unsigned = await new MeshTxBuilder({ params }).metadataValue(REGISTRATION_LABEL, registrationMetadata(w) as never).changeAddress(changeAddress).selectUtxosFrom(utxos).setFee(fee.toString()).complete();

  const tx = Serialization.Transaction.fromCbor(unsigned as never);
  const aux = tx.auxiliaryData()!;
  aux.setNativeScripts(scripts.map((s) => Serialization.NativeScript.fromCbor(s as never)));
  const body = tx.body();
  body.setAuxiliaryDataHash(computeAuxiliaryDataHash(aux.toCore()) as never);
  tx.setBody(body);
  tx.setAuxiliaryData(aux);
  return tx.toCbor();
}

export interface Registration {
  txHash?: string;
  metadata: Label1854Metadata;
  scripts: NativeScriptJson[];
  payment: NativeScriptJson;
  stake?: NativeScriptJson;
}

/** Đọc bản đăng ký từ giao dịch (CBOR). Trả null nếu không phải đăng ký hợp lệ theo CIP-0146. */
export function parseRegistration(txCbor: string): Registration | null {
  try {
    const tx = Serialization.Transaction.fromCbor(txCbor as never);
    const aux = tx.auxiliaryData();
    const scripts = aux?.nativeScripts();
    const md = aux?.metadata()?.metadata()?.get(BigInt(REGISTRATION_LABEL));
    if (!aux || !scripts?.length || !md) return null;
    const json = metadatumToJson(md.toCore());
    return fromParts(json, scripts.map((s) => scriptFromCbor(s.toCbor())));
  } catch {
    return null;
  }
}

/** Dựng Registration từ metadata JSON (Blockfrost json_metadata) + các script. */
export function fromParts(metadata: unknown, scripts: NativeScriptJson[]): Registration | null {
  const raw = metadata as (Omit<Label1854Metadata, "types" | "name" | "description"> & { types?: unknown; name?: unknown; description?: unknown }) | null;
  if (!raw || !Array.isArray(raw.types) || raw.types.length === 0 || raw.types.length !== scripts.length) return null;
  if ("enc" in (raw as object)) return null; // metadata mã hóa (CIP-83): cần khóa giải mã, chưa hỗ trợ
  // Bản đăng ký thật có hai dạng: số theo CIP (0/2) và chuỗi kiểu cũ ("payment"/"stake").
  const types = (raw.types as unknown[]).map(normalizeType);
  if (types.some((t) => t === null)) return null;
  const pay = types.indexOf(0);
  if (pay < 0) return null; // bắt buộc có script thanh toán
  const st = types.indexOf(2);
  const m: Label1854Metadata = { types: types as number[], name: joinText(raw.name), description: joinText(raw.description), participants: raw.participants };
  return { metadata: m, scripts, payment: scripts[pay]!, stake: st >= 0 ? scripts[st] : undefined };
}

const TYPE_NAMES: Record<string, number> = { payment: 0, stake: 2, "0": 0, "2": 2 };
function normalizeType(t: unknown): number | null {
  if (typeof t === "number") return Number.isInteger(t) ? t : null;
  if (typeof t === "string") return TYPE_NAMES[t.toLowerCase()] ?? null;
  return null;
}
/** Chuỗi metadata dài bị chia thành mảng đoạn ≤64 byte: nối lại. */
function joinText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join("");
  return undefined;
}

/** Metadatum (core) → JSON; chuỗi bị chia nhiều đoạn được nối lại. */
function metadatumToJson(x: unknown): unknown {
  if (typeof x === "bigint") return Number(x);
  if (x instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of x) o[String(k)] = metadatumToJson(v);
    return o;
  }
  if (Array.isArray(x)) {
    const arr = x.map(metadatumToJson);
    return arr;
  }
  if (x instanceof Uint8Array) return Buffer.from(x).toString("hex");
  return x;
}

/** Người tham gia có khóa nằm trong script? (dùng khi khám phá) */
export const registrationHasKey = (r: Registration, keyHash: string) => keysOf(r.payment).includes(keyHash) || (r.stake ? keysOf(r.stake).includes(keyHash) : false);

export function requireRegistration(r: Registration | null): Registration {
  if (!r) throw new SharedError("INVALID_TX", "Không phải đăng ký multisig hợp lệ (CIP-0146)");
  return r;
}

import type { UTxO, Protocol } from "@meshsdk/core";

type Fetch = typeof fetch;

/**
 * Bộ lấy UTxO + gửi giao dịch cho Koios (API gốc). Thay cho `KoiosProvider` của Mesh: bản đó trả 0 UTxO
 * với địa chỉ đang có tiền (kiểm tra thực tế trên Preprod), làm ví báo "không đủ số dư" dù có tiền.
 */
export class KoiosFetcher {
  constructor(
    private readonly base: string,
    private readonly params: () => Promise<Protocol>,
    private readonly f: Fetch = (...a) => fetch(...a),
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await this.f(`${this.base}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Koios ${path} lỗi ${r.status}`);
    return (await r.json()) as T;
  }

  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const rows = await this.post<KoiosUtxo[]>("/address_utxos", { _addresses: [address], _extended: true });
    const out: UTxO[] = rows
      .filter((u) => !u.is_spent)
      .map((u) => ({
        input: { txHash: u.tx_hash, outputIndex: u.tx_index },
        output: {
          address: u.address,
          amount: [{ unit: "lovelace", quantity: String(u.value) }, ...(u.asset_list ?? []).map((a) => ({ unit: a.policy_id + a.asset_name, quantity: String(a.quantity) }))],
          ...(u.datum_hash ? { dataHash: u.datum_hash } : {}),
          ...(u.inline_datum?.bytes ? { plutusData: u.inline_datum.bytes } : {}),
        },
      }));
    return asset ? out.filter((u) => u.output.amount.some((a) => a.unit === asset)) : out;
  }

  /** Koios nhận CBOR thô; trả về hash giao dịch. */
  async submitTx(tx: string): Promise<string> {
    if (!/^[0-9a-f]+$/i.test(tx)) throw new Error("Giao dịch không hợp lệ");
    const r = await this.f(`${this.base}/submittx`, { method: "POST", headers: { "content-type": "application/cbor", accept: "application/json" }, body: Buffer.from(tx, "hex") });
    const text = await r.text();
    if (!r.ok) throw new Error(explainSubmitError(text, r.status));
    try {
      const j = JSON.parse(text);
      return typeof j === "string" ? j : String(j);
    } catch {
      return text.replace(/"/g, "").trim();
    }
  }

  fetchProtocolParameters(): Promise<Protocol> {
    return this.params();
  }
}

/** Chuyển lỗi thô của node thành thông báo dễ hiểu; giữ lại một đoạn gốc để tra cứu. */
export function explainSubmitError(raw: string, status = 400): string {
  const t = raw.replace(/\s+/g, " ");
  const tail = ` [${status}] ${t.slice(0, 160)}`;
  if (/All inputs are spent|already been included|BadInputsUTxO|inputs? .*(spent|missing)/i.test(t)) return `Giao dịch đã được gửi trước đó hoặc số dư (UTxO) nó dùng đã bị tiêu bởi giao dịch khác.${tail}`;
  if (/FeeTooSmallUTxO/i.test(t)) return `Phí giao dịch quá thấp.${tail}`;
  if (/ValueNotConservedUTxO/i.test(t)) return `Giao dịch không cân bằng giá trị vào/ra.${tail}`;
  if (/OutputTooSmallUTxO|BabbageOutputTooSmallUTxO/i.test(t)) return `Một khoản ra nhỏ hơn mức tối thiểu của Cardano (khoảng 1 ADA).${tail}`;
  if (/MissingVKeyWitnessesUTXOW|MissingScriptWitnesses|ScriptWitnessNotValidating|NativeScript/i.test(t)) return `Giao dịch thiếu chữ ký hợp lệ hoặc chưa đủ số chữ ký của ví multisig.${tail}`;
  if (/ExpiredUTxO|OutsideValidityInterval/i.test(t)) return `Giao dịch đã hết hạn.${tail}`;
  return `Gửi giao dịch thất bại.${tail}`;
}

interface KoiosUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string | number;
  datum_hash?: string | null;
  inline_datum?: { bytes?: string } | null;
  is_spent?: boolean;
  asset_list?: { policy_id: string; asset_name: string; quantity: string | number }[];
}

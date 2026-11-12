import { Serialization } from "@meshsdk/core-cst";
import { formatAda } from "./balance";

/** Human-readable transaction summary for the user to review before signing. Uses bigint, no floats. */
export function summarizeTx(txCbor: string): string {
  try {
    const body = Serialization.Transaction.fromCbor(txCbor as any).body();
    const lines = body.outputs().map((o, i) => {
      const v = o.amount();
      const assets: string[] = [];
      for (const [assetId, q] of v.multiasset() ?? new Map()) assets.push(`${BigInt(q)} ${String(assetId)}`);
      return `#${i + 1} → ${o.address().toBech32()}: ${formatAda(BigInt(v.coin()))} ADA${assets.length ? ` + ${assets.join(", ")}` : ""}`;
    });
    return [...lines, `Phí: ${formatAda(BigInt(body.fee()))} ADA`].join("\n");
  } catch {
    return "Không giải mã được giao dịch. Chỉ ký nếu bạn tin tưởng trang này.";
  }
}

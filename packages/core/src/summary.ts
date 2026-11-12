import { Serialization } from "@meshsdk/core-cst";

/** Tóm tắt dễ đọc của giao dịch để người dùng duyệt trước khi ký. */
export function summarizeTx(txCbor: string): string {
  try {
    const body = Serialization.Transaction.fromCbor(txCbor as any).body();
    const outs = body.outputs();
    const lines = outs.map((o, i) => {
      const v = o.amount();
      const ada = (Number(v.coin()) / 1e6).toFixed(6).replace(/\.?0+$/, "");
      const tokens = v.multiasset()?.size ?? 0;
      return `#${i + 1} → ${o.address().toBech32()}: ${ada} ADA${tokens ? ` + ${tokens} policy token` : ""}`;
    });
    const fee = (Number(body.fee()) / 1e6).toString();
    return [...lines, `Phí: ${fee} ADA`].join("\n");
  } catch {
    return "Không giải mã được giao dịch. Chỉ ký nếu bạn tin tưởng trang này.";
  }
}

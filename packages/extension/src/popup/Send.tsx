import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { rpc, fmtAda, parseAda, shorten, type AppState } from "./rpc";
import { useAction, type useWalletData } from "./hooks";
import { useT } from "./i18n";
import { Button, Card, Checkbox, ErrorText, Field, IconButton, Notice, Screen, SectionLabel, SignSheet, TopBar, cx, showToast } from "./ui/ui";
import { RecipientField, type Recipient } from "./Contacts";
import { NetworkPill, netOf } from "./Home";

type Data = ReturnType<typeof useWalletData>;
type Asset = { unit: string; quantity: string };
interface RecipientRpc { to: string; lovelace: string; minLovelace: string; assets: Asset[] }
interface SendPreviewRpc extends RecipientRpc {
  txHash: string; fee: string; totalLovelace: string; recipients: RecipientRpc[]; max: boolean; memo?: string[];
  change: { address: string; lovelace: string; assets: Asset[] };
}

/** One recipient row of the form. */
interface Row { key: number; to: string; recipient?: Recipient; amt: string; qty: Record<string, string>; tokensOpen: boolean }
const MAX_ROWS = 20;
const MEMO_LINE_BYTES = 64;
const MEMO_MAX_LINES = 16;
let nextKey = 1;
let preset: Record<string, string> | undefined;
/** Open Send with a token already filled in (NFT gallery, AI-24). Used once. */
export const presetSend = (unit: string, quantity: string) => { preset = { [unit]: quantity }; };
const newRow = (): Row => {
  const qty = preset ?? {};
  preset = undefined;
  return { key: nextKey++, to: "", amt: "", qty, tokensOpen: Object.keys(qty).length > 0 };
};

/** Number of 64-byte CIP-20 lines a memo needs (same rule as the wallet core). */
export function memoLineCount(text: string): number {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return 0;
  const enc = new TextEncoder();
  let n = 0;
  for (const line of t.split("\n")) {
    let cur = "";
    for (const ch of line) {
      if (enc.encode(cur + ch).length > MEMO_LINE_BYTES) { n++; cur = ""; }
      cur += ch;
    }
    n++;
  }
  return n;
}

/** Send to one or more recipients, send max, CIP-20 memo (AI-5, AI-6, AI-22, AI-23). */
export function Send({ st, data, go }: { st: AppState; data: Data; go: (r: string) => void }) {
  const t = useT();
  const net = netOf(st);
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [max, setMax] = useState(false);
  const [memo, setMemo] = useState("");
  const [formErr, setFormErr] = useState("");
  const [preview, setPreview] = useState<SendPreviewRpc>();
  const owned = data.bal?.assets ?? [];
  const nameOf = (unit: string) => {
    const a = owned.find((x) => x.unit === unit);
    return a?.assetName ?? (a?.assetNameHex ? `0x${a.assetNameHex}` : shorten(unit, 8));
  };
  const multi = rows.length > 1;
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosenOf = (r: Row): [string, string][] => Object.entries(r.qty).filter(([, q]) => q.trim() !== "");
  const memoLines = memoLineCount(memo);

  const prepare = useAction(async () => {
    const outputs = rows.map((r) => {
      const lovelace = !max && r.amt.trim() ? parseAda(r.amt) : undefined;
      return {
        to: r.recipient!.address,
        ...(lovelace !== undefined && lovelace !== null ? { lovelace: lovelace.toString() } : {}),
        assets: chosenOf(r).map(([unit, q]) => ({ unit, quantity: q.trim() })),
      };
    });
    setPreview(await rpc<SendPreviewRpc>({ type: "prepareSend", outputs, max, memo: memo.trim() || undefined }));
  });

  const send = useAction(async (password: string) => {
    const hash = await rpc<string>({ type: "confirmSend", txHash: preview!.txHash, password });
    setPreview(undefined);
    showToast(t("send.done"), net.explorerTxUrl + hash);
    void data.reload();
    go("/");
  });

  const review = () => {
    for (const [i, r] of rows.entries()) {
      const n = multi ? ` (#${i + 1})` : "";
      const lovelace = r.amt.trim() ? parseAda(r.amt) : undefined;
      const chosen = chosenOf(r);
      if (r.to.trim().startsWith("$") && !r.recipient) return setFormErr(t("handle.notResolved") + n);
      if (!r.recipient) return setFormErr(t("send.badAddr", { prefix: net.addressPrefix, net: net.label }) + n);
      if (!max && lovelace === null) return setFormErr(t("send.badAmt") + n);
      if (chosen.some(([, q]) => !/^\d+$/.test(q.trim()) || BigInt(q.trim()) <= 0n)) return setFormErr(t("send.badQty") + n);
      if (!max && !chosen.length && (lovelace === undefined || lovelace === null || lovelace < 1_000_000n)) return setFormErr(t("send.minAmt") + n);
    }
    if (memoLines > MEMO_MAX_LINES) return setFormErr(t("send.memoTooLong"));
    setFormErr("");
    send.setError("");
    void prepare.run();
  };

  if (wallet?.kind === "watch")
    return <Screen><TopBar title={t("send.title")} onBack={() => go("/")} /><Notice tone="warn">{t("send.watchOnly")}</Notice></Screen>;

  const ready = rows.every((r) => r.to.trim() && (max || r.amt.trim() || chosenOf(r).length));
  return (
    <>
      <Screen footer={<Button variant="primary" block onClick={review} loading={prepare.busy} disabled={!ready}>{t("send.review")}</Button>}>
        <TopBar title={t("send.title")} onBack={() => go("/")} right={<NetworkPill net={net} />} />
        <div className="space-y-3.5 animate-fade-up">
          {rows.map((r, i) => {
            const chosen = chosenOf(r);
            const body = (
              <div className="space-y-3">
                <RecipientField value={r.to} onChange={(to) => update(r.key, { to })} onResolved={(recipient) => update(r.key, { recipient })} prefix={net.addressPrefix} own={data.addr ? [data.addr] : []}
                  label={multi ? `${t("send.to")} #${i + 1}` : undefined} />
                {max ? (
                  <Notice>{t("send.maxHint")}</Notice>
                ) : (
                  <Field label={multi ? `${t("send.amount")} #${i + 1}` : t("send.amount")} hint={chosen.length ? t("send.adaOptional") : t("send.max")}>
                    <input className="field" inputMode="decimal" aria-label={multi ? `${t("send.amount")} #${i + 1}` : t("send.amount")} placeholder="0.0" value={r.amt} onChange={(e) => update(r.key, { amt: e.target.value })} data-testid="send-amount" />
                  </Field>
                )}
                {owned.length > 0 && (
                  <div>
                    <button className="flex w-full items-center gap-1.5 text-left" onClick={() => update(r.key, { tokensOpen: !r.tokensOpen })} aria-expanded={r.tokensOpen || chosen.length > 0}>
                      <SectionLabel className="mb-0 flex-1">{max ? t("send.tokensMax") : t("send.tokens")}{chosen.length ? ` · ${chosen.length}` : ""}</SectionLabel>
                      <ChevronDown size={14} className={cx("text-moon-dim transition", (r.tokensOpen || chosen.length > 0) && "rotate-180")} />
                    </button>
                    {(r.tokensOpen || chosen.length > 0 || (!multi && i === 0)) && (
                      <Card className="mt-1.5 space-y-2 p-3">
                        {owned.map((a) => (
                          <label key={a.unit} className="flex items-center gap-2" data-testid="send-token">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] text-ink">{nameOf(a.unit)}</span>
                              <span className="block truncate font-mono text-[10.5px] text-moon-dim">{shorten(a.policyId, 8)} · {BigInt(a.quantity).toLocaleString("en-US")}</span>
                            </span>
                            {max && <button className="font-mono text-[11px] text-ink underline decoration-[rgb(var(--ink)/0.3)] underline-offset-2 hover:decoration-ink" onClick={(e) => { e.preventDefault(); update(r.key, { qty: { ...r.qty, [a.unit]: a.quantity } }); }}>{t("send.all")}</button>}
                            <input className="field w-28 text-right" inputMode="numeric" aria-label={`${t("send.tokenQty")} ${nameOf(a.unit)}`} placeholder="0"
                              value={r.qty[a.unit] ?? ""} onChange={(e) => update(r.key, { qty: { ...r.qty, [a.unit]: e.target.value } })} />
                          </label>
                        ))}
                      </Card>
                    )}
                  </div>
                )}
              </div>
            );
            return multi ? (
              <Card key={r.key} className="space-y-2 p-3" data-testid="send-row">
                <div className="flex items-center"><span className="flex-1 text-[12px] font-medium text-moon-soft">{t("send.recipientN", { n: String(i + 1) })}</span>
                  <IconButton label={t("send.removeRecipient")} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={14} /></IconButton></div>
                {body}
              </Card>
            ) : <div key={r.key} data-testid="send-row">{body}</div>;
          })}

          {!max && rows.length < MAX_ROWS && (
            <Button block onClick={() => setRows((rs) => [...rs, newRow()])} data-testid="send-add-recipient"><Plus size={14} /> {t("send.addRecipient")}</Button>
          )}
          {!multi && (
            <Checkbox checked={max} onChange={(v) => { setMax(v); setFormErr(""); }}>
              <span data-testid="send-max">{t("send.sendMax")}</span>
            </Checkbox>
          )}

          <Field label={t("send.memo")} hint={<span className={cx(memoLines > MEMO_MAX_LINES && "text-bad")}>{t("send.memoHint", { n: String(memoLines), max: String(MEMO_MAX_LINES) })}</span>}>
            <textarea className="field min-h-[56px] resize-none" maxLength={1200} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("send.memoPlaceholder")} data-testid="send-memo" />
          </Field>
          {memo.trim() && <Notice tone="warn">{t("send.memoPublic")}</Notice>}
          <ErrorText error={formErr || prepare.error} />
        </div>
      </Screen>
      {preview && (
        <SignSheet title={t("send.sheetTitle")} onSign={(pw) => void send.run(pw)} onCancel={() => setPreview(undefined)} busy={send.busy} error={send.error}>
          <Card className="space-y-2 p-3" data-testid="send-preview">
            {preview.recipients.map((p, i) => {
              const r = rows[i]?.recipient;
              return (
                <div key={i} className={cx("space-y-1", i > 0 && "border-t border-hair pt-2")} data-testid="send-preview-recipient">
                  <div className="font-mono text-[10.5px] text-moon-dim">{preview.recipients.length > 1 ? t("send.recipientN", { n: String(i + 1) }) : t("send.amountLine")} · {net.label}</div>
                  <div className={cx("font-semibold tabular-nums text-ink", preview.recipients.length > 1 ? "text-[16px]" : "text-[22px]")}>{fmtAda(p.lovelace)} {net.unit}</div>
                  {p.assets.map((a) => (
                    <div key={a.unit} className="flex justify-between text-[13px] text-ink"><span className="truncate">{nameOf(a.unit)}</span><span className="tabular-nums">{BigInt(a.quantity).toLocaleString("en-US")}</span></div>
                  ))}
                  {p.assets.length > 0 && !preview.max && <p className="text-[11px] text-moon-dim">{t("send.minAda")}: {fmtAda(p.minLovelace)} {net.unit}</p>}
                  {r && (r.label || r.handle) && r.address === p.to && <div className="text-[12.5px] font-medium text-ink" data-testid="send-to-label">{[r.label, r.handle].filter(Boolean).join(" · ")}</div>}
                  <div className="break-all font-mono text-[11.5px] text-moon">{p.to}</div>
                  {r && r.address === p.to && !r.known && <p className="text-[11px] text-warn">{t("contacts.firstSendShort")}</p>}
                </div>
              );
            })}
            {preview.max && <Notice>{t("send.maxPreview")}</Notice>}
            {preview.memo && (
              <div className="border-t border-hair pt-2">
                <div className="font-mono text-[10.5px] text-moon-dim">{t("send.memo")}</div>
                <p className="whitespace-pre-wrap break-words text-[12px] text-ink" data-testid="send-preview-memo">{preview.memo.join("")}</p>
              </div>
            )}
            <div className="flex justify-between border-t border-hair pt-2 text-[12.5px] text-moon"><span>{t("send.fee")}</span><span className="tabular-nums" data-testid="send-fee">{fmtAda(preview.fee)} {net.unit}</span></div>
            <div className="flex justify-between text-[12.5px] font-medium text-ink"><span>{t("send.total")}</span><span className="tabular-nums">{fmtAda(preview.totalLovelace)} {net.unit}</span></div>
            {(BigInt(preview.change.lovelace) > 0n || preview.change.assets.length > 0) && (
              <div className="flex justify-between text-[11.5px] text-moon-dim"><span>{t("send.change")}</span><span className="tabular-nums">{fmtAda(preview.change.lovelace)} {net.unit}{preview.change.assets.length ? ` + ${preview.change.assets.length} token` : ""}</span></div>
            )}
          </Card>
        </SignSheet>
      )}
    </>
  );
}

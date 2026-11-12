import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, ExternalLink, FileText, RefreshCw, X } from "lucide-react";
import { rpc, fmtAda, shorten, type AppState, type SharedWalletInfo } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Button, Card, ErrorText, Field, IconButton, Screen, SectionLabel, Spinner, TopBar, cx } from "./ui/ui";
import { netOf } from "./Home";

/** A transaction from the historyPage / txDetail RPCs (bigints as strings), AI-21. */
export interface TxItem {
  hash: string; blockTime: number; blockHeight: number; own: string[]; direction: "in" | "out" | "self";
  netLovelace: string; tokens: { unit: string; quantity: string }[]; fee: string; feePaid: string;
  inputs: { address: string; lovelace: string; assets: { unit: string; quantity: string }[] }[];
  outputs: { address: string; lovelace: string; assets: { unit: string; quantity: string }[] }[];
  metadata?: Record<string, unknown>; memo?: string;
}

const PAGE = 10;

/** Asset name from the unit (policy id = first 56 hex), readable when it is printable UTF-8. */
export function tokenLabel(unit: string): string {
  const hex = unit.slice(56);
  if (hex && /^([0-9a-f]{2})+$/i.test(hex)) {
    try {
      const s = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16))));
      if (/^[\p{L}\p{N}\p{P}\p{S} ]+$/u.test(s)) return s;
    } catch { /* not UTF-8 */ }
  }
  return shorten(unit, 8);
}

const signed = (q: string) => (BigInt(q) > 0n ? "+" : "") + BigInt(q).toLocaleString("en-US");

/** yyyy-mm-dd in local time -> unix seconds at the start (or end) of that day. */
const dayToUnix = (d: string, end = false) => {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(y!, m! - 1, day!, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0).getTime();
  return Math.floor(t / 1000);
};
const today = () => new Date().toLocaleDateString("en-CA");

function DirIcon({ d }: { d: TxItem["direction"] }) {
  const cls = d === "in" ? "bg-ok/15 text-ok" : d === "out" ? "bg-bad/15 text-bad" : "bg-night-800 text-moon";
  return (
    <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", cls)}>
      {d === "in" ? <ArrowDownLeft size={15} /> : d === "out" ? <ArrowUpRight size={15} /> : <ArrowLeftRight size={14} />}
    </span>
  );
}

export function Activity({ st }: { st: AppState }) {
  const t = useT();
  const net = netOf(st);
  const [scope, setScope] = useState(""); // "" = this account, else a multisig wallet id (AC-005)
  const [shared, setShared] = useState<SharedWalletInfo[]>([]);
  const [items, setItems] = useState<TxItem[]>();
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState<string>();
  const [exporting, setExporting] = useState(false);

  useEffect(() => { rpc<SharedWalletInfo[]>({ type: "sharedList" }).then(setShared).catch(() => setShared([])); }, [st.active.walletId]);

  const load = useAction(async (p: number) => {
    const r = await rpc<{ items: TxItem[]; hasMore: boolean }>({ type: "historyPage", page: p, count: PAGE, sharedId: scope || undefined });
    setItems((cur) => (p === 1 ? r.items : [...(cur ?? []), ...r.items.filter((x) => !cur?.some((c) => c.hash === x.hash))]));
    setHasMore(r.hasMore);
    setPage(p);
  });
  const reload = useCallback(() => { setItems(undefined); void load.run(1); }, [scope, st.network, st.active.walletId, st.active.account]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);

  return (
    <>
      <Screen>
        <TopBar title={t("activity.title")} right={<>
          <IconButton label={t("activity.export")} onClick={() => setExporting(true)} data-testid="activity-export"><FileText size={15} /></IconButton>
          <IconButton label={t("dash.refresh")} onClick={reload} disabled={load.busy}><RefreshCw size={15} className={load.busy ? "animate-spin" : ""} /></IconButton>
        </>} />
        <div className="space-y-3 animate-fade-up">
          {shared.length > 0 && (
            <label className="block">
              <span className="sr-only">{t("activity.scope")}</span>
              <select className="field" value={scope} onChange={(e) => setScope(e.target.value)} data-testid="activity-scope" aria-label={t("activity.scope")}>
                <option value="">{t("activity.thisWallet")}</option>
                {shared.map((w) => <option key={w.id} value={w.id}>{t("activity.multisig")}: {w.name}</option>)}
              </select>
            </label>
          )}
          <ErrorText error={load.error} />
          {!items ? (
            <div className="flex justify-center py-6"><Spinner size={20} /></div>
          ) : !items.length ? (
            <p className="py-6 text-center text-[12px] text-moon-dim">{t("activity.empty")}</p>
          ) : (
            <ul className="space-y-1" data-testid="activity-list">
              {items.map((h) => {
                const net0 = BigInt(h.netLovelace);
                return (
                  <li key={h.hash}>
                    <button onClick={() => setOpen(h.hash)} className="flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left transition hover:bg-night-850" data-testid="activity-row">
                      <DirIcon d={h.direction} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[12.5px] text-ink">
                          <span>{t(`activity.dir.${h.direction}`)}</span>
                          {h.tokens.length > 0 && <span className="rounded-full bg-night-800 px-1.5 text-[10.5px] text-moon">{t("activity.tokens", { n: String(h.tokens.length) })}</span>}
                        </div>
                        <div className="truncate text-[11px] text-moon-dim">{new Date(h.blockTime * 1000).toLocaleString()}{h.memo ? ` · ${h.memo.split("\n")[0]}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className={cx("text-[13px] font-medium tabular-nums", net0 > 0n ? "text-ok" : net0 < 0n ? "text-bad" : "text-moon")}>{net0 > 0n ? "+" : ""}{fmtAda(h.netLovelace)}</div>
                        {BigInt(h.feePaid) > 0n && <div className="text-[10.5px] tabular-nums text-moon-dim">{t("send.fee")} {fmtAda(h.feePaid)}</div>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {items && hasMore && <Button block loading={load.busy} onClick={() => void load.run(page + 1)} data-testid="activity-more">{t("activity.more")}</Button>}
        </div>
      </Screen>
      {open && <TxSheet hash={open} sharedId={scope || undefined} explorer={net.explorerTxUrl} unit={net.unit} onClose={() => setOpen(undefined)} />}
      {exporting && <ExportSheet sharedId={scope || undefined} onClose={() => setExporting(false)} />}
    </>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-[2px] animate-fade-up" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92%] space-y-3 overflow-y-auto rounded-t-3xl border-t border-night-700 bg-night-950 p-4 shadow-card">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-ink">{title}</h2>
          <IconButton label={t("common.close")} onClick={onClose}><X size={16} /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function IOList({ title, rows, mine }: { title: string; rows: TxItem["inputs"]; mine: Set<string> }) {
  return (
    <div className="space-y-1">
      <SectionLabel>{title}</SectionLabel>
      {rows.map((r, i) => (
        <div key={i} className={cx("rounded-lg border px-2 py-1.5", mine.has(r.address) ? "border-accent/40 bg-accent/5" : "border-night-800")}>
          <div className="flex justify-between gap-2 text-[11.5px]">
            <span className="truncate font-mono text-moon" title={r.address}>{shorten(r.address, 10)}</span>
            <span className="shrink-0 tabular-nums text-ink">{fmtAda(r.lovelace)}</span>
          </div>
          {r.assets.map((a) => <div key={a.unit} className="flex justify-between text-[10.5px] text-moon-dim"><span className="truncate" title={a.unit}>{tokenLabel(a.unit)}</span><span className="tabular-nums">{BigInt(a.quantity).toLocaleString("en-US")}</span></div>)}
        </div>
      ))}
    </div>
  );
}

/** Inputs, outputs, metadata and the explorer link of one transaction (AC-002). */
function TxSheet({ hash, sharedId, explorer, unit, onClose }: { hash: string; sharedId?: string; explorer: string; unit: string; onClose: () => void }) {
  const t = useT();
  const [tx, setTx] = useState<TxItem>();
  const get = useAction(async () => setTx(await rpc<TxItem>({ type: "txDetail", hash, sharedId })));
  useEffect(() => { void get.run(); }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = new Set(tx?.own ?? []);
  const metaKeys = tx?.metadata ? Object.keys(tx.metadata) : [];
  return (
    <Sheet title={t("activity.detail")} onClose={onClose}>
      <ErrorText error={get.error} />
      {!tx ? (!get.error && <div className="flex justify-center py-6"><Spinner size={20} /></div>) : (
        <div className="space-y-3" data-testid="tx-detail">
          <Card className="space-y-1.5 p-3">
            <div className="flex items-center gap-2"><DirIcon d={tx.direction} /><span className="text-[13px] font-medium text-ink">{t(`activity.dir.${tx.direction}`)}</span></div>
            <div className="text-[20px] font-semibold tabular-nums text-ink">{BigInt(tx.netLovelace) > 0n ? "+" : ""}{fmtAda(tx.netLovelace)} {unit}</div>
            {tx.tokens.map((x) => <div key={x.unit} className="flex justify-between text-[12px] text-ink"><span className="truncate" title={x.unit}>{tokenLabel(x.unit)}</span><span className="tabular-nums">{signed(x.quantity)}</span></div>)}
            <div className="flex justify-between text-[12px] text-moon"><span>{t("send.fee")}</span><span className="tabular-nums">{fmtAda(tx.fee)} {unit}{BigInt(tx.feePaid) === 0n ? ` (${t("activity.feeOther")})` : ""}</span></div>
            <div className="flex justify-between text-[11.5px] text-moon-dim"><span>{new Date(tx.blockTime * 1000).toLocaleString()}</span><span>#{tx.blockHeight}</span></div>
            <div className="break-all font-mono text-[10.5px] text-moon-dim">{tx.hash}</div>
            <a href={explorer + tx.hash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-brand-hi hover:underline">{t("common.explorer")} <ExternalLink size={11} /></a>
          </Card>
          {tx.memo && <div className="space-y-1"><SectionLabel>{t("activity.memo")}</SectionLabel><p className="whitespace-pre-wrap break-words rounded-lg border border-night-800 px-2 py-1.5 text-[12px] text-ink" data-testid="tx-memo">{tx.memo}</p></div>}
          <IOList title={t("activity.inputs", { n: String(tx.inputs.length) })} rows={tx.inputs} mine={mine} />
          <IOList title={t("activity.outputs", { n: String(tx.outputs.length) })} rows={tx.outputs} mine={mine} />
          {metaKeys.length > 0 && (
            <div className="space-y-1">
              <SectionLabel>{t("activity.metadata")}</SectionLabel>
              <pre className="max-h-40 overflow-auto rounded-lg border border-night-800 p-2 font-mono text-[10.5px] text-moon">{JSON.stringify(tx.metadata, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** CSV export for a date range (AC-004): exact amounts, newest first. */
function ExportSheet({ sharedId, onClose }: { sharedId?: string; onClose: () => void }) {
  const t = useT();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const run = useAction(async () => {
    if (!from || !to || from > to) throw new Error(t("activity.badRange"));
    const csv = await rpc<string>({ type: "historyCsv", from: dayToUnix(from), to: dayToUnix(to, true), sharedId });
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cardano-preprod-history_${from}_${to}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onClose();
  });
  return (
    <Sheet title={t("activity.export")} onClose={onClose}>
      <p className="text-[11.5px] leading-relaxed text-moon-dim">{t("activity.exportHint")}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("activity.from")}><input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} data-testid="export-from" /></Field>
        <Field label={t("activity.to")}><input type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid="export-to" /></Field>
      </div>
      <ErrorText error={run.error} />
      <Button variant="primary" block loading={run.busy} onClick={() => void run.run()} data-testid="export-run"><Download size={15} /> {t("activity.download")}</Button>
    </Sheet>
  );
}

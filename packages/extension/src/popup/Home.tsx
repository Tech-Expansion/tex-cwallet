import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Droplet, RefreshCw, ShieldCheck } from "lucide-react";
import { rpc, fmtAda, parseAda, shorten, type AppState, type NetInfo, type WalletMeta } from "./rpc";
import { useAction, useHistory, useWalletData } from "./hooks";
import { useT } from "./i18n";
import { ActionButton, Avatar, Button, Card, CopyField, ErrorText, Field, IconButton, Notice, Qr, Screen, SectionLabel, SignSheet, Spinner, Stars, TopBar, cx, showToast } from "./ui/ui";
import { BackgroundGradient } from "./ui/aceternity/BackgroundGradient";
import { Meteors } from "./ui/aceternity/Meteors";
import { HoverList, useHoverItem } from "./ui/aceternity/HoverHighlight";

type Data = ReturnType<typeof useWalletData>;
export const netOf = (st: AppState) => st.networks.find((n) => n.name === st.network)!;

/** Network label (always preprod). */
export const NetworkPill = ({ net }: { net: NetInfo }) => (
    <span data-testid="network-pill" className="flex items-center gap-1.5 rounded-full border border-night-700 bg-night-900 px-2.5 py-1 text-[11px] font-medium text-moon-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px] shadow-ok" />
      {net.label}
    </span>
  );

export function WalletSwitcher({ wallet, onClick }: { wallet?: WalletMeta; onClick: () => void }) {
  const t = useT();
  return (
    <button onClick={onClick} title={t("dash.chooseWallet")} aria-label={t("dash.chooseWallet")} className="flex min-w-0 items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-night-800">
      <Avatar seed={wallet?.id ?? "w"} size={28}>{(wallet?.name ?? "W").slice(0, 1).toUpperCase()}</Avatar>
      <span className="truncate text-[14px] font-semibold text-ink">{wallet?.name ?? t("common.wallet")}</span>
      <ChevronDown size={15} className="shrink-0 text-moon-dim" />
    </button>
  );
}

function Row({ id, children }: { id: string; children: React.ReactNode }) {
  const { highlight, onMouseEnter } = useHoverItem(id);
  return <li className="relative" onMouseEnter={onMouseEnter}>{highlight}{children}</li>;
}

export function TxList({ hist, explorer, limit }: { hist?: Data["hist"]; explorer: string; limit?: number }) {
  const t = useT();
  if (!hist) return <div className="flex justify-center py-6"><Spinner size={20} /></div>;
  if (!hist.length) return <p className="py-6 text-center text-[12px] text-moon-dim">{t("dash.noTx")}</p>;
  return (
    <HoverList>
      <ul className="space-y-1">
        {hist.slice(0, limit).map((h) => {
          const net = BigInt(h.netLovelace);
          const incoming = net >= 0n;
          return (
            <Row key={h.hash} id={h.hash}>
              <a href={explorer + h.hash} target="_blank" rel="noreferrer" className="relative z-10 flex items-center gap-3 rounded-xl px-1 py-1.5">
                <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", incoming ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad")}>
                  {incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px] text-ink">{shorten(h.hash, 8)}</div>
                  <div className="text-[11px] text-moon-dim">{new Date(h.blockTime * 1000).toLocaleString()}</div>
                </div>
                <span className={cx("text-[13px] font-medium tabular-nums", incoming ? "text-ok" : "text-bad")}>{incoming ? "+" : ""}{fmtAda(h.netLovelace)}</span>
              </a>
            </Row>
          );
        })}
      </ul>
    </HoverList>
  );
}

export function Dashboard({ st, data, go }: { st: AppState; data: Data; go: (r: string) => void }) {
  const t = useT();
  const net = netOf(st);
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const lovelace = data.bal?.lovelace ?? "0";
  const tokens = data.bal?.assets ?? [];
  const watch = wallet?.kind === "watch";

  return (
    <Screen>
      <TopBar
        left={<WalletSwitcher wallet={wallet} onClick={() => go("/wallets")} />}
        right={
          <>
            <IconButton label={t("dash.refresh")} data-testid="resync" disabled={data.loading} onClick={() => void data.reload()}>
              <RefreshCw size={15} className={data.loading ? "animate-spin" : ""} />
            </IconButton>
            <NetworkPill net={net} />
          </>
        }
      />
      <div className="space-y-4 animate-fade-up">
        <BackgroundGradient containerClassName="rounded-[26px]">
          <section className="balance relative overflow-hidden rounded-3xl bg-gradient-to-br from-[rgb(var(--card-1))] via-[rgb(var(--card-2))] to-[rgb(var(--card-3))] p-5">
            <Stars count={14} />
            <Meteors number={7} />
            <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-white/70">
                <ShieldCheck size={12} /> {t("dash.balance")} · {net.unit} {watch && `· ${t("dash.watchOnly")}`}
              </div>
              <div className="mt-2 text-[34px] font-semibold leading-none tracking-tight text-white tabular-nums" data-testid="balance">
                {data.bal ? fmtAda(lovelace) : "…"}
              </div>
              <div className="mt-3 font-mono text-[11px] text-white/70">{shorten(data.addr, 14)}</div>
              {tokens.length > 0 && <div className="mt-1 text-[11px] text-white/70">+ {tokens.length} {t("dash.tokens")}</div>}
            </div>
          </section>
        </BackgroundGradient>

        <div className="flex justify-around">
          <ActionButton icon={<ArrowUpRight size={20} />} label={t("dash.send")} onClick={() => go("/send")} highlight disabled={watch} />
          <ActionButton icon={<ArrowDownLeft size={20} />} label={t("dash.receive")} onClick={() => go("/receive")} />
          {net.faucetUrl && <ActionButton icon={<Droplet size={20} />} label="Faucet" onClick={() => window.open(net.faucetUrl, "_blank")} />}
        </div>

        <ErrorText error={data.error} />

        {tokens.length > 0 && (
          <div>
            <SectionLabel>{t("dash.assets")}</SectionLabel>
            <Card className="p-3">
              <ul className="space-y-2">
                {tokens.map((tk) => (
                  <li key={tk.unit} className="flex items-center gap-3" data-testid="asset">
                    <Avatar seed={tk.unit} size={28}>{(tk.assetName ?? tk.policyId).slice(0, 2)}</Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink" title={tk.assetNameHex}>{tk.assetName ?? (tk.assetNameHex ? `0x${tk.assetNameHex}` : "—")}</span>
                      <span className="block truncate font-mono text-[10.5px] text-moon-dim" title={tk.policyId}>{shorten(tk.policyId, 8)}{tk.assetName && tk.assetNameHex ? ` · ${shorten(tk.assetNameHex, 6)}` : ""}</span>
                    </span>
                    <span className="text-[13px] font-medium tabular-nums text-ink">{BigInt(tk.quantity).toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        <div>
          <SectionLabel>{t("dash.recent")}</SectionLabel>
          <TxList hist={data.hist} explorer={net.explorerTxUrl} limit={3} />
        </div>
      </div>
    </Screen>
  );
}

export function Receive({ st, data, go }: { st: AppState; data: Data; go: (r: string) => void }) {
  const t = useT();
  return (
    <Screen>
      <TopBar title={t("receive.title")} onBack={() => go("/")} right={<NetworkPill net={netOf(st)} />} />
      <div className="space-y-4 animate-fade-up">
        {data.addr ? <Qr value={data.addr} /> : <div className="grid h-[236px] place-items-center"><Spinner /></div>}
        <CopyField value={data.addr} testId="addr" />
        <Notice tone="info">{t("receive.note")}</Notice>
        {netOf(st).faucetUrl && <a href={netOf(st).faucetUrl} target="_blank" rel="noreferrer" className="block text-center text-[12px] text-accent hover:underline">{t("dash.faucet")}</a>}
      </div>
    </Screen>
  );
}

export function Send({ st, data, go }: { st: AppState; data: Data; go: (r: string) => void }) {
  const t = useT();
  const net = netOf(st);
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [formErr, setFormErr] = useState("");
  const [sheet, setSheet] = useState(false);
  const lovelace = parseAda(amt);

  const send = useAction(async (password: string) => {
    const hash = await rpc<string>({ type: "sendAda", to: to.trim(), lovelace: lovelace!.toString(), password });
    setSheet(false);
    showToast(t("send.done"), net.explorerTxUrl + hash);
    void data.reload();
    go("/");
  });

  const review = () => {
    if (lovelace === null) return setFormErr(t("send.badAmt"));
    if (lovelace < 1_000_000n) return setFormErr(t("send.minAmt"));
    if (!to.trim().startsWith(net.addressPrefix)) return setFormErr(t("send.badAddr", { prefix: net.addressPrefix, net: net.label }));
    setFormErr("");
    send.setError("");
    setSheet(true);
  };

  if (wallet?.kind === "watch")
    return <Screen><TopBar title={t("send.title")} onBack={() => go("/")} /><Notice tone="warn">{t("send.watchOnly")}</Notice></Screen>;

  return (
    <>
      <Screen footer={<Button variant="primary" block onClick={review} disabled={!to || !amt}>{t("send.review")}</Button>}>
        <TopBar title={t("send.title")} onBack={() => go("/")} right={<NetworkPill net={net} />} />
        <div className="space-y-3.5 animate-fade-up">
          <Field label={t("send.to")}><textarea className="field min-h-[76px] resize-none font-mono" aria-label={t("send.to")} placeholder={`${net.addressPrefix}…`} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t("send.amount")} hint={t("send.max")}><input className="field" inputMode="decimal" aria-label={t("send.amount")} placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          <ErrorText error={formErr} />
        </div>
      </Screen>
      {sheet && (
        <SignSheet title={t("send.sheetTitle")} onSign={(pw) => void send.run(pw)} onCancel={() => setSheet(false)} busy={send.busy} error={send.error}>
          <Card className="space-y-2 p-3">
            <div className="text-[11px] uppercase tracking-wide text-moon-dim">{t("send.amountLine")} · {net.label}</div>
            <div className="text-[22px] font-semibold tabular-nums text-ink">{fmtAda(lovelace!)} {net.unit}</div>
            <div className="text-[11px] uppercase tracking-wide text-moon-dim">{t("send.toLine")}</div>
            <div className="break-all font-mono text-[11.5px] text-moon">{to.trim()}</div>
            <p className="text-[11px] text-moon-dim">{t("send.feeNote")}</p>
          </Card>
        </SignSheet>
      )}
    </>
  );
}

export function Activity({ st }: { st: AppState }) {
  const t = useT();
  const data = useHistory(st, 20);
  return (
    <Screen>
      <TopBar title={t("activity.title")} right={<IconButton label={t("dash.refresh")} onClick={() => void data.reload()} disabled={data.loading}><RefreshCw size={15} className={data.loading ? "animate-spin" : ""} /></IconButton>} />
      <div className="animate-fade-up"><TxList hist={data.hist} explorer={netOf(st).explorerTxUrl} /></div>
    </Screen>
  );
}

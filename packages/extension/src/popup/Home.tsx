import { ArrowDownLeft, ArrowUpRight, ChevronDown, Droplet, Image as ImageIcon, Layers, RefreshCw } from "lucide-react";
import { fmtAda, shorten, type AppState, type NetInfo, type WalletMeta } from "./rpc";
import { useWalletData } from "./hooks";
import { useT } from "./i18n";
import { ActionButton, Avatar, Card, CopyField, ErrorText, IconButton, Notice, Qr, Screen, SectionLabel, Spinner, StatusPill, TopBar } from "./ui/ui";

type Data = ReturnType<typeof useWalletData>;
export const netOf = (st: AppState) => st.networks.find((n) => n.name === st.network)!;

/** Network label (always preprod), as a live status pill. */
export const NetworkPill = ({ net }: { net: NetInfo }) => <StatusPill testId="network-pill">{net.label}</StatusPill>;

export function WalletSwitcher({ wallet, onClick }: { wallet?: WalletMeta; onClick: () => void }) {
  const t = useT();
  return (
    <button onClick={onClick} title={t("dash.chooseWallet")} aria-label={t("dash.chooseWallet")} className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-night-850">
      <Avatar seed={wallet?.id ?? "w"} size={28}>{(wallet?.name ?? "W").slice(0, 1)}</Avatar>
      <span className="truncate text-[15px] font-medium tracking-display text-ink">{wallet?.name ?? t("common.wallet")}</span>
      <ChevronDown size={15} className="shrink-0 text-moon-dim" />
    </button>
  );
}

/** ADA amount as a figure: the number large, the unit at 0.42em in muted text. */
export const Figure = ({ value, unit, className, testId }: { value: string; unit: string; className?: string; testId?: string }) => (
  <div className={className}>
    <span data-testid={testId} className="tabular-nums">{value}</span>
    <span className="ml-1.5 align-baseline text-[0.42em] tracking-normal opacity-60">{unit}</span>
  </div>
);

export function TxList({ hist, explorer, limit }: { hist?: Data["hist"]; explorer: string; limit?: number }) {
  const t = useT();
  if (!hist) return <div className="flex justify-center py-6"><Spinner size={20} /></div>;
  if (!hist.length) return <p className="border border-dashed border-hair py-6 text-center text-[12px] text-moon-dim">{t("dash.noTx")}</p>;
  return (
    <ul className="divide-y divide-[rgb(var(--ink)/0.08)] border-y border-hair">
      {hist.slice(0, limit).map((h) => {
        const incoming = BigInt(h.netLovelace) >= 0n;
        return (
          <li key={h.hash}>
            <a href={explorer + h.hash} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-night-850">
              <span className="grid h-8 w-8 shrink-0 place-items-center border border-hair text-ink">
                {incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] text-ink">{shorten(h.hash, 8)}</div>
                <div className="font-mono text-[10.5px] text-moon-dim">{new Date(h.blockTime * 1000).toLocaleString()}</div>
              </div>
              <span className="font-mono text-[12.5px] tabular-nums text-ink">{incoming ? "+" : ""}{fmtAda(h.netLovelace)}</span>
            </a>
          </li>
        );
      })}
    </ul>
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
      <div className="space-y-5 animate-fade-up">
        <section className="balance bg-hatch relative border border-[rgb(var(--on-panel)/0.12)] bg-[rgb(var(--panel))] p-5 text-[rgb(var(--on-panel))]">
          <div className="flex items-center gap-2.5 font-mono text-[11px] opacity-60">
            <span aria-hidden className="h-px w-5 bg-current" />
            {t("dash.balance")} · {net.unit}{watch && ` · ${t("dash.watchOnly")}`}
          </div>
          <Figure className="mt-4 text-[44px] leading-none tracking-figure" value={data.bal ? fmtAda(lovelace) : "…"} unit={net.unit} testId="balance" />
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[rgb(var(--on-panel)/0.12)] pt-3 font-mono text-[11px]">
            <span className="truncate opacity-60">{shorten(data.addr, 12)}</span>
            {tokens.length > 0 && <span className="shrink-0 opacity-60">+{tokens.length} {t("dash.tokens")}</span>}
          </div>
        </section>

        <div className="flex justify-between px-1">
          <ActionButton icon={<ArrowUpRight size={20} />} label={t("dash.send")} onClick={() => go("/send")} highlight disabled={watch} />
          <ActionButton icon={<ArrowDownLeft size={20} />} label={t("dash.receive")} onClick={() => go("/receive")} />
          <ActionButton icon={<ImageIcon size={20} />} label="NFT" onClick={() => go("/nfts")} />
          {!watch && <ActionButton icon={<Layers size={20} />} label="Stake" onClick={() => go("/staking")} />}
          {net.faucetUrl && <ActionButton icon={<Droplet size={20} />} label="Faucet" onClick={() => window.open(net.faucetUrl, "_blank")} />}
        </div>

        <ErrorText error={data.error} />

        {tokens.length > 0 && (
          <div>
            <SectionLabel>{t("dash.assets")}</SectionLabel>
            <Card className="divide-y divide-[rgb(var(--ink)/0.08)] p-0">
              {tokens.map((tk) => (
                <div key={tk.unit} className="flex items-center gap-3 px-3 py-2.5" data-testid="asset">
                  <Avatar seed={tk.unit} size={28}>{(tk.assetName ?? tk.policyId).slice(0, 2)}</Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink" title={tk.assetNameHex}>{tk.assetName ?? (tk.assetNameHex ? `0x${tk.assetNameHex}` : "—")}</span>
                    <span className="block truncate font-mono text-[10.5px] text-moon-dim" title={tk.policyId}>{shorten(tk.policyId, 8)}{tk.assetName && tk.assetNameHex ? ` · ${shorten(tk.assetNameHex, 6)}` : ""}</span>
                  </span>
                  <span className="font-mono text-[12.5px] tabular-nums text-ink">{BigInt(tk.quantity).toLocaleString("en-US")}</span>
                </div>
              ))}
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
  const net = netOf(st);
  return (
    <Screen>
      <TopBar title={t("receive.title")} onBack={() => go("/")} right={<NetworkPill net={net} />} />
      <div className="space-y-4 animate-fade-up">
        {data.addr ? <Qr value={data.addr} /> : <div className="grid h-[236px] place-items-center"><Spinner /></div>}
        <div>
          <SectionLabel>{net.addressPrefix}…</SectionLabel>
          <CopyField value={data.addr} testId="addr" />
        </div>
        <Notice tone="info">{t("receive.note")}</Notice>
        {net.faucetUrl && <a href={net.faucetUrl} target="_blank" rel="noreferrer" className="block text-center text-[12.5px] text-ink underline decoration-[rgb(var(--ink)/0.3)] underline-offset-4 hover:decoration-ink">{t("dash.faucet")}</a>}
      </div>
    </Screen>
  );
}

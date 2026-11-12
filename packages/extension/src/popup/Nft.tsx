import { useEffect, useState } from "react";
import { ArrowUpRight, ImageOff, RefreshCw, X } from "lucide-react";
import { rpc, shorten, type AppState } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Button, Card, ErrorText, IconButton, Notice, Screen, SectionLabel, Spinner, TopBar, cx } from "./ui/ui";
import { presetSend } from "./Send";

/** NFT from the nftList RPC (AI-24). imageUrl is already checked against the allowed hosts. */
export interface NftItem {
  unit: string; policyId: string; assetName: string; standard: "cip25" | "cip68" | "none";
  name: string; image?: string; imageUrl?: string; mediaType?: string; description?: string;
  files: { name?: string; mediaType?: string; src: string }[];
  attributes: { key: string; value: string }[];
}

/** Image only through <img> (no HTML/SVG documents, no scripts); a placeholder when blocked or broken. */
function NftImage({ item, className }: { item: NftItem; className?: string }) {
  const t = useT();
  const [broken, setBroken] = useState(false);
  if (!item.imageUrl || broken)
    return <div className={cx("grid place-items-center bg-night-900 text-moon-dim", className)} title={item.image ? t("nft.blocked") : t("nft.noImage")}><ImageOff size={22} /></div>;
  return <img src={item.imageUrl} alt={item.name} loading="lazy" referrerPolicy="no-referrer" decoding="async" draggable={false} onError={() => setBroken(true)} className={cx("bg-night-900 object-cover", className)} />;
}

/** NFT gallery: grid, details, send (display and transfer only). */
export function Nfts({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<NftItem[]>();
  const [open, setOpen] = useState<NftItem>();
  const load = useAction(async (refresh?: boolean) => setItems(await rpc<NftItem[]>({ type: "nftList", refresh })));
  useEffect(() => { setItems(undefined); void load.run(); }, [st.active.walletId, st.active.account]); // eslint-disable-line react-hooks/exhaustive-deps
  const watch = st.wallets.find((w) => w.id === st.active.walletId)?.kind === "watch";
  return (
    <>
      <Screen>
        <TopBar title={t("nft.title")} onBack={() => go("/")} right={<IconButton label={t("dash.refresh")} onClick={() => void load.run(true)} disabled={load.busy}><RefreshCw size={15} className={load.busy ? "animate-spin" : ""} /></IconButton>} />
        <div className="space-y-3 animate-fade-up">
          <ErrorText error={load.error} />
          {!items ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : !items.length ? (
            <p className="py-6 text-center text-[12px] text-moon-dim">{t("nft.empty")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5" data-testid="nft-grid">
              {items.map((n) => (
                <li key={n.unit}>
                  <button onClick={() => setOpen(n)} className="w-full overflow-hidden rounded-xl border border-night-800 text-left transition hover:border-accent/50" data-testid="nft-card">
                    <NftImage item={n} className="aspect-square w-full" />
                    <div className="truncate px-2 py-1.5 text-[12px] text-ink">{n.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10.5px] text-moon-dim">{t("nft.gatewayNote", { gw: st.ipfsGateway ?? "" })}</p>
        </div>
      </Screen>
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-[2px] animate-fade-up" role="dialog" aria-modal="true" aria-label={open.name}>
          <div className="max-h-[92%] space-y-3 overflow-y-auto rounded-t-3xl border-t border-night-700 bg-night-950 p-4 shadow-card" data-testid="nft-detail">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{open.name}</h2>
              <IconButton label={t("common.close")} onClick={() => setOpen(undefined)}><X size={16} /></IconButton>
            </div>
            <NftImage item={open} className="mx-auto aspect-square w-full max-w-[280px] rounded-2xl" />
            {open.description && <p className="whitespace-pre-wrap break-words text-[12.5px] text-moon">{open.description}</p>}
            <Card className="space-y-1 p-3 text-[11.5px]">
              <Row k={t("nft.policy")} v={<span className="break-all font-mono">{open.policyId}</span>} />
              <Row k={t("nft.assetName")} v={open.assetName} />
              <Row k={t("nft.standard")} v={open.standard === "none" ? "—" : open.standard.toUpperCase().replace("CIP", "CIP-")} />
              {open.mediaType && <Row k="mediaType" v={open.mediaType} />}
            </Card>
            {open.attributes.length > 0 && (
              <div>
                <SectionLabel>{t("nft.attributes")}</SectionLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  {open.attributes.map((a) => (
                    <div key={a.key} className="rounded-lg border border-night-800 px-2 py-1.5"><div className="truncate text-[10.5px] uppercase text-moon-dim">{a.key}</div><div className="break-words text-[12px] text-ink">{a.value}</div></div>
                  ))}
                </div>
              </div>
            )}
            {open.files.length > 0 && (
              <div>
                <SectionLabel>{t("nft.files")}</SectionLabel>
                <ul className="space-y-1 text-[11px] text-moon">{open.files.map((f, i) => <li key={i} className="truncate font-mono" title={f.src}>{f.mediaType ?? "?"} · {shorten(f.src, 18)}</li>)}</ul>
              </div>
            )}
            <Notice>{t("nft.noTrade")}</Notice>
            {!watch && (
              <Button variant="primary" block onClick={() => { presetSend(open.unit, "1"); go("/send"); }} data-testid="nft-send"><ArrowUpRight size={15} /> {t("nft.send")}</Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2"><span className="w-24 shrink-0 text-moon-dim">{k}</span><span className="min-w-0 flex-1 text-ink">{v}</span></div>
);

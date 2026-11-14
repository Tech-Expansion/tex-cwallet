import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { rpc, fmtAda, shorten, type AppState } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Button, Card, ErrorText, Notice, Screen, SectionLabel, SignSheet, Spinner, TopBar, cx, showToast } from "./ui/ui";

interface Pool { poolId: string; ticker?: string; name?: string; margin: number; fixedCost: string; pledge: string; liveStake: string; saturation?: number; retiring?: boolean }
interface Info { stakeAddress: string; registered: boolean; poolId?: string; rewards: string; pool?: Pool }
interface Preview { txHash: string; action: "delegate" | "withdraw" | "deregister"; certs: string[]; poolId?: string; fee: string; deposit: string; refund: string; withdrawal: string; change: string }

const pct = (n?: number, digits = 1) => (n === undefined ? "—" : `${n.toFixed(digits)}%`);
const adaShort = (l: string) => {
  const a = BigInt(l) / 1_000_000n;
  return a >= 1_000_000n ? `${(Number(a) / 1e6).toFixed(2)}M` : a >= 1_000n ? `${(Number(a) / 1e3).toFixed(1)}K` : a.toString();
};

function PoolCard({ p, current, onPick, busy }: { p: Pool; current?: boolean; onPick?: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <Card className="space-y-1.5 p-3" data-testid="pool">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-accent/15 px-1.5 text-[12px] font-semibold text-accent">{p.ticker ?? "—"}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{p.name ?? shorten(p.poolId, 10)}</span>
        {p.retiring && <span className="text-[10.5px] text-warn">{t("stake.retiring")}</span>}
      </div>
      <div className="grid grid-cols-4 gap-1 text-[10.5px]">
        {[[t("stake.saturation"), pct(p.saturation)], [t("stake.margin"), pct(p.margin * 100, 2)], [t("stake.fixedCost"), adaShort(p.fixedCost)], [t("stake.pledge"), adaShort(p.pledge)]].map(([k, v]) => (
          <div key={k}><div className="text-moon-dim">{k}</div><div className={cx("tabular-nums text-ink", k === t("stake.saturation") && (p.saturation ?? 0) > 100 && "text-bad")}>{v}</div></div>
        ))}
      </div>
      <div className="truncate font-mono text-[10px] text-moon-dim" title={p.poolId}>{p.poolId}</div>
      {onPick && <Button block disabled={current} loading={busy} onClick={onPick} data-testid="pool-delegate">{current ? t("stake.current") : t("stake.delegate")}</Button>}
    </Card>
  );
}

/** Staking (AI-28): status, pool search/compare, delegate, withdraw, deregister. Facts only, no yield marketing. */
export function Staking({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const unit = st.networks.find((n) => n.name === st.network)!.unit;
  const [info, setInfo] = useState<Info>();
  const [q, setQ] = useState("");
  const [pools, setPools] = useState<Pool[]>();
  const [preview, setPreview] = useState<Preview>();
  const load = useAction(async () => setInfo(await rpc<Info>({ type: "stakeInfo" })));
  useEffect(() => { void load.run(); }, [st.active.walletId, st.active.account]); // eslint-disable-line react-hooks/exhaustive-deps
  const search = useAction(async () => setPools(await rpc<Pool[]>({ type: "searchPools", query: q.trim() })));
  const prepare = useAction(async (action: Preview["action"], poolId?: string) => setPreview(await rpc<Preview>({ type: "prepareStake", action, poolId })));
  const sign = useAction(async (password: string) => {
    await rpc({ type: "confirmSend", txHash: preview!.txHash, password });
    setPreview(undefined);
    showToast(t("stake.sent"));
    setTimeout(() => void load.run(), 1500);
  });
  const rewards = BigInt(info?.rewards ?? "0");
  return (
    <>
      <Screen>
        <TopBar title={t("stake.title")} onBack={() => go("/")} />
        <div className="space-y-3.5 animate-fade-up">
          <ErrorText error={load.error} />
          {!info ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : (
            <Card className="space-y-2 p-3" data-testid="stake-status">
              <div className="text-[12.5px] text-ink">{!info.registered ? t("stake.notRegistered") : info.pool ? t("stake.delegatedTo", { ticker: info.pool.ticker ?? shorten(info.pool.poolId, 8) }) : info.poolId ? t("stake.delegatedTo", { ticker: shorten(info.poolId, 8) }) : t("stake.registeredNoPool")}</div>
              <div className="flex justify-between text-[12px] text-moon"><span>{t("stake.rewards")}</span><span className="tabular-nums" data-testid="stake-rewards">{fmtAda(rewards)} {unit}</span></div>
              <div className="truncate font-mono text-[10px] text-moon-dim" title={info.stakeAddress}>{info.stakeAddress}</div>
              {info.registered && (
                <div className="grid grid-cols-2 gap-2">
                  <Button disabled={rewards <= 0n} loading={prepare.busy && !preview} onClick={() => void prepare.run("withdraw")} data-testid="stake-withdraw">{t("stake.withdraw")}</Button>
                  <Button onClick={() => void prepare.run("deregister")} data-testid="stake-deregister">{t("stake.deregister")}</Button>
                </div>
              )}
            </Card>
          )}
          {info?.pool && <PoolCard p={info.pool} />}

          <div>
            <SectionLabel>{t("stake.findPool")}</SectionLabel>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void search.run(); }}>
              <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("stake.searchPlaceholder")} aria-label={t("stake.findPool")} data-testid="pool-search" />
              <Button type="submit" loading={search.busy} disabled={!q.trim()}><Search size={15} /></Button>
            </form>
          </div>
          <ErrorText error={search.error || prepare.error} />
          {pools && !pools.length && <p className="text-center text-[12px] text-moon-dim">{t("stake.noPools")}</p>}
          {pools?.map((p) => <PoolCard key={p.poolId} p={p} current={info?.registered && info.poolId === p.poolId} busy={prepare.busy} onPick={() => void prepare.run("delegate", p.poolId)} />)}
          <Notice>{t("stake.facts")}</Notice>
        </div>
      </Screen>
      {preview && (
        <SignSheet title={t(`stake.sheet.${preview.action}`)} onSign={(pw) => void sign.run(pw)} onCancel={() => setPreview(undefined)} busy={sign.busy} error={sign.error}>
          <Card className="space-y-1.5 p-3 text-[12.5px]" data-testid="stake-preview">
            {preview.poolId && <div className="break-all text-ink"><span className="text-moon-dim">{t("stake.pool")}: </span>{pools?.find((p) => p.poolId === preview.poolId)?.ticker ?? ""} <span className="font-mono text-[10.5px]">{preview.poolId}</span></div>}
            {BigInt(preview.deposit) > 0n && <div className="flex justify-between text-warn" data-testid="stake-deposit"><span>{t("stake.deposit")}</span><span className="tabular-nums">{fmtAda(preview.deposit)} {unit}</span></div>}
            {BigInt(preview.refund) > 0n && <div className="flex justify-between text-ok" data-testid="stake-refund"><span>{t("stake.refund")}</span><span className="tabular-nums">+{fmtAda(preview.refund)} {unit}</span></div>}
            {BigInt(preview.withdrawal) > 0n && <div className="flex justify-between text-ok"><span>{t("stake.withdrawal")}</span><span className="tabular-nums">+{fmtAda(preview.withdrawal)} {unit}</span></div>}
            <div className="flex justify-between text-moon"><span>{t("send.fee")}</span><span className="tabular-nums">{fmtAda(preview.fee)} {unit}</span></div>
            {BigInt(preview.deposit) > 0n && <p className="text-[11px] text-moon-dim">{t("stake.depositNote")}</p>}
            {preview.action === "deregister" && <p className="text-[11px] text-moon-dim">{t("stake.deregNote")}</p>}
          </Card>
        </SignSheet>
      )}
    </>
  );
}

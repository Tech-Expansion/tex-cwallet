import { useState } from "react";
import { Eye, EyeOff, Lock, Plus, Trash2, Check } from "lucide-react";
import { rpc, type AppState, type Approval, type NetName } from "./rpc";
import { useAction } from "./hooks";
import { usePrefs, useT, type Lang, type ThemePref } from "./i18n";
import { Avatar, Button, Card, Checkbox, ErrorText, Field, Notice, Screen, SectionLabel, Segmented, Spinner, TopBar, cx, showToast } from "./ui/ui";
import { useEffect } from "react";

export function Settings({ st, refresh, go }: { st: AppState; refresh: () => void; go: (r: string) => void }) {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const [pw, setPw] = useState("");
  const [words, setWords] = useState<string[]>();
  const reveal = useAction(async () => setWords(await rpc<string[]>({ type: "exportMnemonic", id: wallet!.id, password: pw })));
  const remove = useAction(async () => {
    if (!wallet || !confirm(t("settings.removeConfirm", { name: wallet.name }))) return;
    await rpc({ type: "removeWallet", id: wallet.id });
    refresh();
    go("/");
  });
  const lock = useAction(async () => { await rpc({ type: "lock" }); refresh(); });

  return (
    <Screen>
      <TopBar title={t("settings.title")} />
      <div className="space-y-4 animate-fade-up">
        <div>
          <SectionLabel>{t("settings.network")}</SectionLabel>
          <Segmented<NetName> value={st.network} onChange={(n) => void rpc({ type: "setNetwork", network: n }).then(refresh)}
            options={st.networks.filter((n) => !n.realFunds || st.mainnetEnabled).map((n) => [n.name, n.label] as const)} />
        </div>
        <div>
          <SectionLabel>{t("settings.theme")}</SectionLabel>
          <Segmented<ThemePref> value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[["system", t("settings.theme.system")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]] as const} />
        </div>
        <div>
          <SectionLabel>{t("settings.language")}</SectionLabel>
          <Segmented<Lang> value={prefs.lang} onChange={(lang) => setPrefs({ lang })} options={[["vi", "Tiếng Việt"], ["en", "English"]] as const} />
        </div>

        <Advanced st={st} refresh={refresh} />

        {wallet?.kind === "mnemonic" && (
          <Card className="space-y-2.5 p-3">
            <SectionLabel className="mb-0">{t("settings.backup")}</SectionLabel>
            <p className="text-[11.5px] text-moon-dim">{t("settings.backupHint")}</p>
            {words ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">{words.map((w, i) => <span key={i} className="rounded-lg border border-night-700 bg-night-900 px-2 py-1.5 text-[11px]"><span className="text-moon-dim">{i + 1}.</span> {w}</span>)}</div>
                <Button block onClick={() => { setWords(undefined); setPw(""); }}><EyeOff size={15} /> {t("settings.hide")}</Button>
              </>
            ) : (
              <>
                <input className="field" type="password" aria-label={t("common.password")} placeholder={t("common.password")} value={pw} onChange={(e) => setPw(e.target.value)} />
                <Button block loading={reveal.busy} disabled={!pw} onClick={() => void reveal.run()}><Eye size={15} /> {t("settings.show")}</Button>
              </>
            )}
            <ErrorText error={reveal.error} />
          </Card>
        )}

        <ErrorText error={remove.error || lock.error} />
        <Notice>{t("settings.autolock")}</Notice>
        <Button block onClick={() => void lock.run()}><Lock size={15} /> {t("settings.lock")}</Button>
        {wallet && <Button variant="danger" block onClick={() => void remove.run()}><Trash2 size={15} /> {t("settings.remove")}</Button>}
      </div>
    </Screen>
  );
}

export function Wallets({ st, refresh, go }: { st: AppState; refresh: () => void; go: (r: string) => void }) {
  const t = useT();
  const pick = useAction(async (walletId: string, account: number) => { await rpc({ type: "setActive", walletId, account }); refresh(); go("/"); });
  const addAcc = useAction(async (walletId: string) => { await rpc({ type: "addAccount", walletId }); refresh(); });
  return (
    <Screen footer={<Button variant="primary" block onClick={() => go("/wallets/add")}><Plus size={16} /> {t("wallets.add")}</Button>}>
      <TopBar title={t("wallets.title")} onBack={() => go("/")} />
      <div className="space-y-3 animate-fade-up">
        <ErrorText error={pick.error || addAcc.error} />
        {st.wallets.map((w) => (
          <Card key={w.id} className="space-y-2 p-3">
            <div className="flex items-center gap-2.5">
              <Avatar seed={w.id} size={30}>{w.name.slice(0, 1).toUpperCase()}</Avatar>
              <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold text-ink">{w.name}</div><div className="text-[11px] text-moon-dim">{w.kind === "watch" ? t("dash.watchOnly") : `${w.accounts.length} ${t("wallets.account").toLowerCase()}`}</div></div>
              {w.kind === "mnemonic" && <button className="rounded-lg px-2 py-1 text-[11px] text-accent hover:bg-night-800" onClick={() => void addAcc.run(w.id)}>+ {t("wallets.addAccount")}</button>}
            </div>
            {w.accounts.map((a) => {
              const active = w.id === st.active.walletId && a.index === st.active.account;
              return (
                <button key={a.index} onClick={() => void pick.run(w.id, a.index)} className={cx("flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[13px] transition", active ? "border-accent/50 bg-accent/10 text-ink" : "border-night-700 text-moon-soft hover:border-night-600")}>
                  <span>{a.name}</span>{active && <Check size={15} className="text-accent" />}
                </button>
              );
            })}
          </Card>
        ))}
      </div>
    </Screen>
  );
}

export function Approve({ id }: { id: string }) {
  const t = useT();
  const [a, setA] = useState<Approval | null | undefined>(undefined);
  const load = useAction(async () => setA((await rpc<Approval[]>({ type: "pendingApprovals" })).find((x) => x.id === id) ?? null));
  useEffect(() => { void load.run(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = useAction(async (ok: boolean) => { await rpc({ type: "resolveApproval", id, ok }); window.close(); });
  if (a === undefined) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (a === null) return <Screen><TopBar title="" /><Notice tone="warn">{t("approve.gone")}</Notice></Screen>;
  const title = a.kind === "enable" ? t("approve.enable") : a.kind === "signTx" ? t("approve.signTx") : t("approve.signData");
  return (
    <Screen footer={<div className="grid grid-cols-2 gap-2"><Button block onClick={() => void resolve.run(false)}>{t("approve.reject")}</Button><Button variant="primary" block loading={resolve.busy} onClick={() => void resolve.run(true)}>{t("approve.accept")}</Button></div>}>
      <TopBar title={title} />
      <div className="space-y-3 animate-fade-up">
        <Field label={t("approve.from")}><div className="rounded-xl border border-night-700 bg-night-900 px-3 py-2 font-mono text-[12px] text-ink" data-testid="origin">{a.origin}</div></Field>
        {a.detail && <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-night-700 bg-night-900 p-3 font-mono text-[11.5px] text-moon" data-testid="detail">{a.detail}</pre>}
        <Notice tone="warn">{t("approve.warn")}</Notice>
        <ErrorText error={resolve.error} />
      </div>
    </Screen>
  );
}

/** Mainnet (tiền thật) mặc định tắt; proxy dữ liệu Blockfrost cho mainnet. */
function Advanced({ st, refresh }: { st: AppState; refresh: () => void }) {
  const t = useT();
  const [ack, setAck] = useState(false);
  const [url, setUrl] = useState(st.provider.proxyUrl ?? "");
  const [forTest, setForTest] = useState(!!st.provider.proxyForTestnets);
  const toggle = useAction(async (enabled: boolean) => { await rpc({ type: "setMainnet", enabled }); setAck(false); refresh(); });
  const save = useAction(async () => {
    const u = url.trim();
    // Extension chỉ gọi được host đã được cấp quyền: xin quyền cho đúng origin của proxy.
    if (u && typeof chrome !== "undefined" && chrome.permissions) {
      const origin = new URL(u).origin + "/*";
      const ok = (await chrome.permissions.contains({ origins: [origin] })) || (await chrome.permissions.request({ origins: [origin] }));
      if (!ok) throw new Error(t("settings.proxyDenied"));
    }
    await rpc({ type: "setProvider", proxyUrl: u, proxyForTestnets: forTest });
    showToast(t("settings.saved"));
    refresh();
  });
  return (
    <Card className="space-y-3 p-3">
      <SectionLabel className="mb-0">{t("settings.advanced")}</SectionLabel>
      <div className="space-y-2">
        <div className="text-[13px] font-medium text-ink">{t("settings.mainnet")}</div>
        {st.mainnetEnabled ? (
          <Button block onClick={() => void toggle.run(false)} loading={toggle.busy}>{t("common.cancel")} Mainnet</Button>
        ) : (
          <>
            <Notice tone="warn">{t("settings.mainnetWarn")}</Notice>
            <Checkbox checked={ack} onChange={setAck}>{t("settings.mainnetAck")}</Checkbox>
            <Button block disabled={!ack} loading={toggle.busy} data-testid="enable-mainnet" onClick={() => void toggle.run(true)}>{t("settings.mainnet")}</Button>
          </>
        )}
        <ErrorText error={toggle.error} />
      </div>
      <Field label={t("settings.proxy")} hint={t("settings.proxyHint")}>
        <input className="field font-mono" aria-label={t("settings.proxy")} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Checkbox checked={forTest} onChange={setForTest}>{t("settings.proxyTestnet")}</Checkbox>
      <ErrorText error={save.error} />
      <Button block loading={save.busy} onClick={() => void save.run()}>{t("settings.proxySave")}</Button>
    </Card>
  );
}

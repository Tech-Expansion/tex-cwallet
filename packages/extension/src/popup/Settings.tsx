import { useState } from "react";
import { BookUser, ChevronRight, ShieldCheck, ShieldAlert, Eye, EyeOff, Lock, Plus, Trash2, Check } from "lucide-react";
import { rpc, fmtAda, type AppState, type Approval } from "./rpc";
import { useAction } from "./hooks";
import { usePrefs, useT, type Lang, type ThemePref } from "./i18n";
import { Avatar, Button, Card, Checkbox, ErrorText, Field, Notice, Screen, SectionLabel, Segmented, SignSheet, Spinner, TopBar, cx, showToast } from "./ui/ui";
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
          <div data-testid="network-fixed" className="text-[13px] text-moon">Preprod</div>
        </div>
        <div>
          <SectionLabel>{t("settings.theme")}</SectionLabel>
          <Segmented<ThemePref> value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[["system", t("settings.theme.system")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]] as const} />
        </div>
        <div>
          <SectionLabel>{t("settings.language")}</SectionLabel>
          <Segmented<Lang> value={prefs.lang} onChange={(lang) => setPrefs({ lang })} options={[["vi", "Tiếng Việt"], ["en", "English"]] as const} />
        </div>

        <button onClick={() => go("/verify")} className="flex w-full items-center gap-2.5 rounded-xl border border-night-800 bg-night-900 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-night-850" data-testid="open-verify">
          <ShieldCheck size={16} className="text-accent" /><span className="flex-1">{t("verify.title")}</span><ChevronRight size={15} className="text-moon-dim" />
        </button>
        <button onClick={() => go("/contacts")} className="flex w-full items-center gap-2.5 rounded-xl border border-night-800 bg-night-900 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-night-850" data-testid="open-contacts">
          <BookUser size={16} className="text-accent" /><span className="flex-1">{t("contacts.title")}</span><ChevronRight size={15} className="text-moon-dim" />
        </button>

        {wallet?.kind === "mnemonic" && <Collateral st={st} />}

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
        {a.signData ? (
          <>
            <Field label={t("approve.signAddress")}><div className="break-all rounded-xl border border-night-700 bg-night-900 px-3 py-2 font-mono text-[11.5px] text-ink" data-testid="sign-address">{a.signData.address}</div></Field>
            {a.signData.looksLikeTx && <Notice tone="warn"><span data-testid="sign-tx-warning">{t("approve.looksLikeTx")}</span></Notice>}
            <Field label={a.signData.text !== undefined ? t("approve.payloadText") : t("approve.payloadHex")}>
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-night-700 bg-night-900 p-3 font-mono text-[11.5px] text-moon" data-testid="detail">{a.signData.text ?? a.signData.hex}</pre>
            </Field>
            {a.signData.text !== undefined && <details className="text-[11px] text-moon-dim"><summary className="cursor-pointer">{t("approve.payloadHex")}</summary><div className="break-all font-mono">{a.signData.hex}</div></details>}
          </>
        ) : a.detail && <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-night-700 bg-night-900 p-3 font-mono text-[11.5px] text-moon" data-testid="detail">{a.detail}</pre>}
        <Notice tone="warn">{t("approve.warn")}</Notice>
        <ErrorText error={resolve.error} />
      </div>
    </Screen>
  );
}

type CollateralRpc = { state: "none" | "pending" | "ready"; txHash?: string; lovelace?: string; protected: boolean };

/** Collateral for dApps (AI-25): a 5 ADA UTxO to ourselves, kept out of normal sends while protected. */
function Collateral({ st }: { st: AppState }) {
  const t = useT();
  const [c, setC] = useState<CollateralRpc>();
  const [preview, setPreview] = useState<{ txHash: string; fee: string }>();
  const load = useAction(async () => setC(await rpc<CollateralRpc>({ type: "collateralStatus" })));
  useEffect(() => { void load.run(); }, [st.active.walletId, st.active.account]); // eslint-disable-line react-hooks/exhaustive-deps
  const prepare = useAction(async () => setPreview(await rpc<{ txHash: string; fee: string }>({ type: "prepareCollateral" })));
  const sign = useAction(async (password: string) => {
    await rpc({ type: "confirmSend", txHash: preview!.txHash, password });
    setPreview(undefined);
    showToast(t("collateral.created"));
    await load.run();
  });
  const remove = useAction(async () => { if (confirm(t("collateral.removeConfirm"))) { await rpc({ type: "removeCollateral" }); await load.run(); } });
  const protect = useAction(async (on: boolean) => { await rpc({ type: "setCollateralProtected", on }); await load.run(); });
  const unit = st.networks.find((n) => n.name === st.network)!.unit;
  return (
    <Card className="space-y-2.5 p-3" data-testid="collateral">
      <SectionLabel className="mb-0">{t("collateral.title")}</SectionLabel>
      <p className="text-[11.5px] text-moon-dim">{t("collateral.hint")}</p>
      {!c ? <Spinner size={18} /> : (
        <>
          <p className="text-[12.5px] text-ink" data-testid="collateral-state">
            {c.state === "ready" ? t("collateral.ready", { ada: fmtAda(c.lovelace ?? "0"), unit }) : c.state === "pending" ? t("collateral.pending") : t("collateral.none")}
          </p>
          {c.state === "none" && <Button block loading={prepare.busy} onClick={() => void prepare.run()} data-testid="collateral-create">{t("collateral.create")}</Button>}
          {c.state !== "none" && <Button block loading={remove.busy} onClick={() => void remove.run()}>{t("collateral.remove")}</Button>}
          <Checkbox checked={c.protected} onChange={(v) => void protect.run(v)}>{t("collateral.protect")}</Checkbox>
        </>
      )}
      <ErrorText error={load.error || prepare.error || remove.error || protect.error} />
      {preview && (
        <SignSheet title={t("collateral.sheet")} onSign={(pw) => void sign.run(pw)} onCancel={() => setPreview(undefined)} busy={sign.busy} error={sign.error}>
          <p className="text-[12.5px] text-ink">{t("collateral.sheetBody", { unit })}</p>
          <p className="text-[12px] text-moon">{t("send.fee")}: {fmtAda(preview.fee)} {unit}</p>
        </SignSheet>
      )}
    </Card>
  );
}

function Advanced({ st, refresh }: { st: AppState; refresh: () => void }) {
  const t = useT();
  return (
    <Card className="space-y-3 p-3">
      <SectionLabel className="mb-0">{t("settings.advanced")}</SectionLabel>
      {st.ipfsGateways && (
        <Field label={t("settings.ipfsGateway")} hint={t("settings.ipfsGatewayHint")}>
          <select className="field" value={st.ipfsGateway} data-testid="ipfs-gateway"
            onChange={(e) => void rpc({ type: "setIpfsGateway", gateway: e.target.value }).then(() => { showToast(t("settings.saved")); refresh(); })}>
            {st.ipfsGateways.map((g) => <option key={g} value={g}>{g.replace("https://", "")}</option>)}
          </select>
        </Field>
      )}
    </Card>
  );
}

/** Check a CIP-8 signature someone sent (AI-26 AC-003). Runs locally, nothing is sent anywhere. */
export function VerifySignature({ go }: { go: (r: string) => void }) {
  const t = useT();
  const [payload, setPayload] = useState("");
  const [isHex, setIsHex] = useState(false);
  const [signature, setSignature] = useState("");
  const [key, setKey] = useState("");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<boolean>();
  const check = useAction(async () => setResult(await rpc<boolean>({ type: "verifySignature", payload, payloadIsHex: isHex, signature, key, address: address.trim() || undefined })));
  const reset = () => setResult(undefined);
  return (
    <Screen footer={<Button variant="primary" block loading={check.busy} disabled={!signature.trim() || !key.trim()} onClick={() => void check.run()} data-testid="verify-run">{t("verify.check")}</Button>}>
      <TopBar title={t("verify.title")} onBack={() => go("/settings")} />
      <div className="space-y-3 animate-fade-up">
        <p className="text-[11.5px] text-moon-dim">{t("verify.hint")}</p>
        <Field label={t("verify.payload")}><textarea className="field min-h-[60px] resize-none" value={payload} onChange={(e) => { setPayload(e.target.value); reset(); }} data-testid="verify-payload" /></Field>
        <Checkbox checked={isHex} onChange={(v) => { setIsHex(v); reset(); }}>{t("verify.payloadIsHex")}</Checkbox>
        <Field label="COSE_Sign1 (signature)"><textarea className="field min-h-[60px] resize-none font-mono text-[11px]" value={signature} onChange={(e) => { setSignature(e.target.value); reset(); }} data-testid="verify-signature" /></Field>
        <Field label="COSE_Key (key)"><textarea className="field min-h-[48px] resize-none font-mono text-[11px]" value={key} onChange={(e) => { setKey(e.target.value); reset(); }} data-testid="verify-key" /></Field>
        <Field label={t("verify.address")}><input className="field font-mono text-[11px]" value={address} onChange={(e) => { setAddress(e.target.value); reset(); }} placeholder="addr_test1… / stake_test1…" /></Field>
        <ErrorText error={check.error} />
        {result !== undefined && (
          <div data-testid="verify-result" className={cx("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium", result ? "border-ok/30 bg-ok/10 text-ok" : "border-bad/30 bg-bad/10 text-bad")}>
            {result ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />} {result ? t("verify.valid") : t("verify.invalid")}
          </div>
        )}
      </div>
    </Screen>
  );
}

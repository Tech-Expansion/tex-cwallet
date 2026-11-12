import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, FileDown, Plus, Radar, ShieldCheck, Trash2, Users } from "lucide-react";
import { rpc, fmtAda, parseAda, shorten, type AppState, type RequestItem, type SharedWalletInfo, type TxPreview } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Avatar, Button, Card, CopyField, ErrorText, Field, Notice, Screen, SectionLabel, SignSheet, Spinner, TopBar, cx, showToast, useCopy } from "./ui/ui";
import { NetworkPill, netOf } from "./Home";

export const MESH_MULTISIG_URL = "https://multisig.meshjs.dev";
const walletRoute = (id: string) => `/multisig/w/${id}`;

/** Điều hướng con của tab Multisig: /multisig, /multisig/new, /multisig/import, /multisig/w/<id> */
export function Multisig({ st, route, go }: { st: AppState; route: string; go: (r: string) => void }) {
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const t = useT();
  if (wallet?.kind !== "mnemonic")
    return <Screen><TopBar title={t("ms2.title")} right={<NetworkPill net={netOf(st)} />} /><Notice tone="warn">{t("ms2.walletWatch")}</Notice></Screen>;
  const w = route.match(/^\/multisig\/w\/(.+)$/);
  if (w) return <Detail st={st} id={w[1]!} go={go} />;
  if (route === "/multisig/new") return <Create st={st} go={go} />;
  if (route === "/multisig/import") return <Import go={go} />;
  return <List st={st} go={go} />;
}

function KeyCard() {
  const t = useT();
  const [hash, setHash] = useState("");
  // Chỉ số khóa do ví tự chọn (khóa chưa dùng đầu tiên) — người dùng không cần biết.
  useEffect(() => { void rpc<{ keyHash: string }>({ type: "sharedNext" }).then((k) => setHash(k.keyHash)).catch(() => setHash("")); }, []);
  return (
    <Card className="space-y-2 p-3">
      <SectionLabel className="mb-0">{t("ms2.mykey")}</SectionLabel>
      <p className="text-[11.5px] text-moon-dim">{t("ms2.mykeyHint")}</p>
      <CopyField value={hash} testId="ms-keyhash" />
    </Card>
  );
}

function List({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const [wallets, setWallets] = useState<SharedWalletInfo[]>();
  const load = useAction(async () => setWallets(await rpc<SharedWalletInfo[]>({ type: "sharedList" })));
  // Tự khám phá một lần khi mở tab (im lặng): ví đã đăng ký on-chain sẽ tự hiện, chỉ số khóa tự cập nhật
  useEffect(() => {
    void (async () => {
      await load.run();
      try { await rpc({ type: "sharedDiscover" }); await load.run(); } catch { /* không có mạng/nguồn dữ liệu: bỏ qua */ }
    })();
  }, [st.network, st.active.walletId]); // eslint-disable-line react-hooks/exhaustive-deps
  const discover = useAction(async () => {
    const found = await rpc<SharedWalletInfo[]>({ type: "sharedDiscover" });
    showToast(found.length ? t("ms2.found", { n: String(found.length) }) : t("ms2.none"));
    await load.run();
  });
  return (
    <Screen>
      <TopBar title={t("ms2.title")} right={<NetworkPill net={netOf(st)} />} />
      <div className="space-y-4 animate-fade-up">
        <div className="grid grid-cols-3 gap-2">
          <Button loading={discover.busy} onClick={() => void discover.run()} data-testid="ms-discover"><Radar size={15} /> {t("ms2.discover")}</Button>
          <Button variant="primary" onClick={() => go("/multisig/new")} data-testid="ms-new"><Plus size={15} /> {t("ms2.create")}</Button>
          <Button onClick={() => go("/multisig/import")} data-testid="ms-import"><FileDown size={15} /> {t("ms2.import")}</Button>
        </div>
        <ErrorText error={discover.error || load.error} />
        {!wallets ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : wallets.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-moon-dim">{t("ms2.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li key={w.id}>
                <button onClick={() => go(walletRoute(w.id))} data-testid="ms-item" className="flex w-full items-center gap-3 rounded-2xl border border-night-700 bg-night-850 p-3 text-left transition hover:border-night-600">
                  <Avatar seed={w.id} size={34}><Users size={16} /></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-ink">{w.name}</div>
                    <div className="text-[11px] text-moon-dim">{t("ms2.of", { m: String(w.required), n: String(w.signers.length) })} · {shorten(w.address, 8)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <KeyCard />
        <a href={MESH_MULTISIG_URL} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 text-[12px] text-accent hover:underline"><ExternalLink size={13} /> {t("ms2.mesh")}</a>
      </div>
    </Screen>
  );
}

function Create({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [required, setRequired] = useState(2);
  const [lines, setLines] = useState("");
  const cosigners = lines.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const m = l.match(/^(.*?)[\s,:;]+(\S+)$/);
    return m ? { name: m[1]!.trim() || `Cosigner ${i + 2}`, keyHash: m[2]! } : { name: `Cosigner ${i + 2}`, keyHash: l };
  });
  const create = useAction(async () => {
    const w = await rpc<SharedWalletInfo>({ type: "sharedCreate", name, required, cosigners, myName: myName || undefined });
    showToast(t("ms2.created"));
    go(walletRoute(w.id));
  });
  const n = cosigners.length + 1;
  return (
    <Screen footer={<Button variant="primary" block loading={create.busy} disabled={!cosigners.length} onClick={() => void create.run()} data-testid="ms-create-submit">{t("ms2.create")}</Button>}>
      <TopBar title={t("ms2.create")} onBack={() => go("/multisig")} right={<NetworkPill net={netOf(st)} />} />
      <div className="space-y-3.5 animate-fade-up">
        <Field label={t("ms2.name")}><input className="field" aria-label={t("ms2.name")} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("ms2.myName")}><input className="field" aria-label={t("ms2.myName")} value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
        <Field label={t("ms2.cosigners")} hint={t("ms2.cosignerHint")}>
          <textarea className="field min-h-[110px] resize-none font-mono text-[11.5px]" aria-label={t("ms2.cosigners")} placeholder={"Bình 3200…\nChi 732b…"} value={lines} onChange={(e) => setLines(e.target.value)} />
        </Field>
        <Field label={`${t("ms2.required")} (${required}/${n})`}>
          <input className="field w-24" type="number" min={1} max={n} aria-label={t("ms2.required")} value={required} onChange={(e) => setRequired(Math.max(1, Math.min(n, Number(e.target.value) || 1)))} />
        </Field>
        <ErrorText error={create.error} />
      </div>
    </Screen>
  );
}

function Import({ go }: { go: (r: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const imp = useAction(async () => {
    const w = await rpc<SharedWalletInfo>({ type: "sharedImport", input: text, name: name || undefined });
    showToast(t("ms2.imported"));
    go(walletRoute(w.id));
  });
  return (
    <Screen footer={<Button variant="primary" block loading={imp.busy} disabled={!text.trim()} onClick={() => void imp.run()} data-testid="ms-import-submit">{t("ms2.import")}</Button>}>
      <TopBar title={t("ms2.import")} onBack={() => go("/multisig")} />
      <div className="space-y-3.5 animate-fade-up">
        <Field label={t("ms2.name")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("ms2.paste")}><textarea className="field min-h-[140px] resize-none font-mono text-[11.5px]" aria-label={t("ms2.paste")} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <ErrorText error={imp.error} />
      </div>
    </Screen>
  );
}

function PreviewCard({ p, required, mine, own }: { p: TxPreview; required: number; mine?: boolean; own: string }) {
  const t = useT();
  return (
    <div className="space-y-1.5 text-[12px]">
      {p.outputs.map((o, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-moon-soft" title={o.address}>{o.change || o.address === own ? t("ms2.change") : shorten(o.address, 9)}</span>
          <span className="shrink-0 font-medium tabular-nums text-ink">{fmtAda(o.lovelace)}</span>
        </div>
      ))}
      <div className="flex justify-between text-moon-dim"><span>{t("ms2.fee")}</span><span className="tabular-nums">{fmtAda(p.fee)}</span></div>
      <div className={cx("flex items-center gap-1.5 font-medium", p.enough ? "text-ok" : "text-warn")}>
        {p.enough ? <Check size={13} /> : <ShieldCheck size={13} />} {t("ms2.sigs", { n: String(new Set(p.signedBy).size), m: String(required) })}{mine ? ` · ${t("ms2.signed")}` : ""}
      </div>
    </div>
  );
}

function Detail({ st, id, go }: { st: AppState; id: string; go: (r: string) => void }) {
  const t = useT();
  const net = netOf(st);
  const [w, setW] = useState<SharedWalletInfo | null>();
  const [bal, setBal] = useState<string>();
  const [myKey, setMyKey] = useState("");
  const [reqs, setReqs] = useState<RequestItem[]>();
  const [signFor, setSignFor] = useState<{ kind: "propose" } | { kind: "sign"; request: string } | undefined>();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [memo, setMemo] = useState("");
  const [paste, setPaste] = useState("");
  const [review, setReview] = useState<{ request: string; preview: TxPreview; memo?: string; iSigned: boolean }>();
  const { copy } = useCopy();

  const reload = useCallback(async () => {
    const list = await rpc<SharedWalletInfo[]>({ type: "sharedList" });
    const cur = list.find((x) => x.id === id) ?? null;
    setW(cur);
    if (!cur) return;
    if (cur.myIndex !== undefined) void rpc<{ keyHash: string }>({ type: "sharedKey", y: cur.myIndex }).then((k) => setMyKey(k.keyHash)).catch(() => setMyKey(""));
    setReqs(await rpc<RequestItem[]>({ type: "sharedRequests", id }));
    void rpc<{ unit: string; quantity: string }[]>({ type: "sharedBalance", id }).then((b) => setBal(b.find((x) => x.unit === "lovelace")?.quantity ?? "0")).catch(() => setBal(undefined));
  }, [id]);
  const load = useAction(reload);
  useEffect(() => { void load.run(); }, [id, st.network]); // eslint-disable-line react-hooks/exhaustive-deps

  const register = useAction(async () => { const h = await rpc<string>({ type: "sharedRegister", id }); showToast(t("ms2.registered"), net.explorerTxUrl + h); await reload(); });
  const act = useAction(async (password: string) => {
    if (!signFor) return;
    if (signFor.kind === "propose") {
      const lov = parseAda(amt);
      if (lov === null) throw new Error("Số ADA không hợp lệ");
      await rpc<string>({ type: "sharedPropose", id, to: to.trim(), lovelace: lov.toString(), memo: memo || undefined, password });
      setTo(""); setAmt(""); setMemo("");
    } else {
      await rpc({ type: "sharedSign", request: signFor.request, password });
      setReview(undefined); setPaste("");
    }
    setSignFor(undefined);
    await reload();
  });
  const submit = useAction(async (request: string) => { const h = await rpc<string>({ type: "sharedSubmit", request }); showToast(t("ms2.submitted"), net.explorerTxUrl + h); await reload(); });
  const check = useAction(async () => { setReview(await rpc({ type: "sharedInspect", request: paste })); });
  const remove = useAction(async () => { if (!w || !confirm(t("ms2.removeConfirm", { name: w.name }))) return; await rpc({ type: "sharedRemove", id }); go("/multisig"); });

  if (w === undefined) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (w === null) return <Screen><TopBar title={t("ms2.title")} onBack={() => go("/multisig")} /><Notice tone="warn">…</Notice></Screen>;
  const canSign = w.myIndex !== undefined;

  return (
    <>
      <Screen>
        <TopBar title={w.name} onBack={() => go("/multisig")} right={<NetworkPill net={net} />} />
        <div className="space-y-4 animate-fade-up">
          <Card className="space-y-2 p-3">
            <div className="flex items-end justify-between">
              <div><div className="text-[11px] uppercase tracking-wide text-moon-dim">{t("ms2.balance")}</div><div className="text-[26px] font-semibold tabular-nums text-ink" data-testid="ms-balance">{bal === undefined ? t("ms2.balanceLoading") : fmtAda(bal)} <span className="text-[13px] text-moon-dim">{net.unit}</span></div></div>
              <div className="text-[12px] font-medium text-moon-soft">{t("ms2.of", { m: String(w.required), n: String(w.signers.length) })}</div>
            </div>
            <CopyField value={w.address} testId="ms-address" />
            <p className="text-[11px] leading-relaxed text-moon-dim">{t("ms2.fundHint")}</p>
          </Card>

          <div>
            <SectionLabel>{t("ms2.signers")}</SectionLabel>
            <ul className="space-y-1.5">
              {w.signers.map((s, i) => (
                <li key={s.keyHash} className="flex items-center gap-2 text-[12px]">
                  <Avatar seed={s.keyHash} size={22}>{(s.name || "?").slice(0, 1).toUpperCase()}</Avatar>
                  <span className="font-medium text-ink">{s.name || `Cosigner ${i + 1}`}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-moon-dim">{shorten(s.keyHash, 8)}</span>
                  {s.keyHash === myKey && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("ms2.you")}</span>}
                </li>
              ))}
            </ul>
            {!canSign && <Notice tone="warn">{t("ms2.noKey")}</Notice>}
          </div>

          {canSign && (
            <Card className="space-y-2.5 p-3">
              <SectionLabel className="mb-0">{t("ms2.propose")}</SectionLabel>
              <textarea className="field min-h-[60px] resize-none font-mono text-[11.5px]" aria-label={t("ms2.to")} placeholder={`${net.addressPrefix}…`} value={to} onChange={(e) => setTo(e.target.value)} />
              <input className="field" inputMode="decimal" aria-label={t("ms2.amount")} placeholder={t("ms2.amount")} value={amt} onChange={(e) => setAmt(e.target.value)} />
              <input className="field" aria-label={t("ms2.memo")} placeholder={t("ms2.memo")} value={memo} onChange={(e) => setMemo(e.target.value)} />
              <Button variant="primary" block disabled={!to.trim() || !amt} data-testid="ms-propose" onClick={() => { act.setError(""); setSignFor({ kind: "propose" }); }}>{t("ms2.propose")}</Button>
            </Card>
          )}

          <div>
            <SectionLabel>{t("ms2.pending")}</SectionLabel>
            {!reqs ? <Spinner size={18} /> : reqs.length === 0 ? <p className="text-[12px] text-moon-dim">{t("ms2.noPending")}</p> : (
              <ul className="space-y-2">
                {reqs.map((r) => (
                  <li key={r.preview.txHash} data-testid="ms-request">
                    <Card className="space-y-2 p-3">
                      {r.memo && <div className="text-[12.5px] font-medium text-ink">{r.memo}</div>}
                      <PreviewCard p={r.preview} required={w.required} mine={r.iSigned} own={w.address} />
                      {r.stale && <Notice tone="warn">{t("ms2.stale")}</Notice>}
                      {r.expired && <Notice tone="warn">{t("ms2.expired")}</Notice>}
                      <div className="grid grid-cols-2 gap-2">
                        <Button onClick={() => { void navigator.clipboard?.writeText(r.request); showToast(t("ms2.copied")); }} data-testid="ms-copy-request">{t("ms2.copyReq")}</Button>
                        {r.preview.enough
                          ? <Button variant="primary" loading={submit.busy} disabled={r.stale || r.expired} onClick={() => void submit.run(r.request)} data-testid="ms-submit">{t("ms2.submit")}</Button>
                          : <Button variant="primary" disabled={r.iSigned || !canSign || r.stale || r.expired} onClick={() => { act.setError(""); setSignFor({ kind: "sign", request: r.request }); }} data-testid="ms-sign">{t("ms2.sign")}</Button>}
                      </div>
                      <button className="text-[11px] text-moon-dim hover:text-bad" onClick={() => void rpc({ type: "sharedDismiss", id, request: r.request }).then(reload)}>{t("ms2.dismiss")}</button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <ErrorText error={submit.error} />
          </div>

          <Card className="space-y-2.5 p-3">
            <SectionLabel className="mb-0">{t("ms2.pasteReq")}</SectionLabel>
            <textarea className="field min-h-[70px] resize-none font-mono text-[11px]" aria-label={t("ms2.pasteReq")} value={paste} onChange={(e) => { setPaste(e.target.value); setReview(undefined); }} />
            {review ? (
              <div className="space-y-2" data-testid="ms-review">
                {review.memo && <div className="text-[12.5px] font-medium text-ink">{review.memo}</div>}
                <PreviewCard p={review.preview} required={w.required} mine={review.iSigned} own={w.address} />
                <Button variant="primary" block disabled={review.iSigned || !canSign} onClick={() => { act.setError(""); setSignFor({ kind: "sign", request: paste }); }} data-testid="ms-review-sign">{t("ms2.sign")}</Button>
              </div>
            ) : <Button block disabled={!paste.trim()} loading={check.busy} onClick={() => void check.run()} data-testid="ms-check">{t("ms2.check")}</Button>}
            <ErrorText error={check.error} />
          </Card>

          <Card className="space-y-2 p-3">
            {w.registeredTx ? <div className="flex items-center gap-1.5 text-[12px] text-ok"><Check size={14} /> {t("ms2.registered")}</div> : canSign && (
              <>
                <p className="text-[11.5px] text-moon-dim">{t("ms2.registerHint")}</p>
                <Button block loading={register.busy} onClick={() => void register.run()} data-testid="ms-register">{t("ms2.register")}</Button>
                <ErrorText error={register.error} />
              </>
            )}
            <Button block onClick={() => void rpc<string>({ type: "sharedExport", id }).then((j) => { void navigator.clipboard?.writeText(j); showToast(t("ms2.copied")); })} data-testid="ms-export">{t("ms2.export")}</Button>
            <Button variant="danger" block onClick={() => void remove.run()}><Trash2 size={15} /> {t("ms2.remove")}</Button>
          </Card>
          <ErrorText error={load.error} />
        </div>
      </Screen>
      {signFor && (
        <SignSheet title={t("ms2.reviewTitle")} onSign={(pw) => void act.run(pw)} onCancel={() => setSignFor(undefined)} busy={act.busy} error={act.error}>
          {signFor.kind === "propose"
            ? <Card className="space-y-1 p-3"><div className="text-[22px] font-semibold tabular-nums text-ink">{amt} {net.unit}</div><div className="break-all font-mono text-[11.5px] text-moon">{to.trim()}</div></Card>
            : review && <Card className="p-3"><PreviewCard p={review.preview} required={w.required} own={w.address} /></Card>}
        </SignSheet>
      )}
    </>
  );
}
